/**
 * dsh-workspace-plus/notice — host half of the 通知 sub-feature.
 *
 * Ported verbatim from the dsh-notice plugin (0.2.1) when it was merged into
 * dsh-workspace-plus as a second loader row: same events, same routes, same
 * Windows transport, same `~/.dsh/notice` store. Only the module identity and
 * the log prefix changed, so an existing dsh-notice install upgrades in place
 * (settings, protocol registration and in-flight notifications all carry over).
 *
 * The plugin watches a running Harness and raises a Windows notification when a
 * conversation needs the user, marking WHICH kind of need it is. Four moments
 * are covered, all of them read from events the Harness already emits, so the
 * plugin never changes what the agent does:
 *
 *   approval/request        a tool call is waiting for a permission decision
 *   user-questions/request  the model asked the user a structured question
 *   session/event turn/end  the turn finished, was interrupted, or failed
 *   agent/error             the agent failed outside a durable turn position
 *
 * Every listener is an observer. The two waterfall listeners are registered with
 * `{ prepend: true }` and call `next()` unconditionally, returning its outcome
 * unchanged — the only shape that leaves the decision with the composed
 * answerers. Prepending is not a preference: a waterfall runs
 * first-registered-first with the first listener outermost, and the shipped
 * remote forwarder (registered at host load, before any bundle row) resolves an
 * approval or a question WITHOUT calling `next()` once the desktop page answers
 * it, so a tail-registered observer would never run in the very environment this
 * plugin targets. Nothing here can allow, deny, or delay a tool call.
 *
 * A click on a notification must reopen the conversation it is about, and that
 * is the one place the plugin leaves the host process:
 *
 *   1. the toast carries a `dsh-notice:open?s=<session>` protocol activation;
 *   2. the plugin registers that protocol under HKCU, pointing at a small
 *      PowerShell launcher that calls this plugin's own loopback route;
 *   3. the route records the session, brings the desktop window forward, and
 *      the browser half — which polls the plugin's route — selects that
 *      conversation through the Harness's own `uiWorkspace.openSession`.
 *
 * Step 3 is why the browser half exists at all: the Host cannot select a
 * conversation in a page's UI, so it publishes the intent and the page applies
 * it through the Client service that owns navigation. In the merged package the
 * browser half is `lib/client.js` — the workspace+ row's client bundle — which
 * hosts the 通知 settings page and the pending-open poll next to the workspace
 * features; when the `notice` row is disabled those two degrade silently.
 *
 * @module dsh-workspace-plus/notice
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  describeAgentError,
  describeApproval,
  describeQuestion,
  describeTurnEnd,
  isInScope,
  openUrl,
} from './format.js'
import {
  KIND_LABELS,
  KINDS,
  clearOverride,
  mergeOverrides,
  normalizeSettings,
  readStore,
  storePath,
  writeStore,
} from './settings.js'
import { ToastDaemon, toastTag } from './toast.js'
import {
  focusDesktopWindow,
  isSupported,
  powershellPath,
  protocolCommand,
  readProtocolCommand,
  registerProtocol,
  unregisterProtocol,
} from './win32.js'

/** Plugin name shown by the loader and in host logs. */
export const name = 'dsh-workspace-plus/notice'

/** Settings and control route the browser half talks to. */
export const API_PATH = '/dsh-notice/api'

/** Route the registered protocol launcher calls. */
export const OPEN_PATH = '/dsh-notice/api/open'

/** Route the browser half polls for a pending "open this conversation" intent. */
export const PENDING_PATH = '/dsh-notice/api/pending'

/** Directory holding this plugin's shipped assets. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** PowerShell launcher the protocol registration points at. */
export const CLICK_SCRIPT = join(MODULE_DIR, 'click.ps1')

/** Largest accepted settings request body. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * How much of an over-long body is read and discarded before the connection is
 * dropped. Bounded so a refusal cannot be turned into a memory sink.
 */
const DRAIN_CAP_BYTES = 8 * 1024 * 1024

/** How long a pending "open this conversation" intent stays valid. */
const PENDING_TTL_MS = 60_000

/**
 * Suppression window for a repeated notification of the same class about the
 * same conversation. A retry loop can append several failing turns within
 * seconds; the toast for each would replace the previous one anyway, so the
 * window only removes flicker and daemon round-trips.
 */
const MIN_REPEAT_MS = 1_200

/** Addresses that mean "this machine" for the loopback fallback below. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
/**
 * Merge the bundle config with the user's runtime overrides.
 *
 * `kinds` is the one nested object, and the settings page flips one class at a
 * time, so it merges key by key while every scalar replaces.
 *
 * @param base - normalized bundle config.
 * @param overrides - stored overrides.
 * @returns complete, normalized effective settings.
 */
export function composeSettings(base, overrides) {
  const patch = overrides !== null && typeof overrides === 'object' ? overrides : {}
  const patchKinds = patch.kinds !== null && typeof patch.kinds === 'object' ? patch.kinds : {}
  return normalizeSettings({
    ...base,
    ...patch,
    kinds: { ...base.kinds, ...patchKinds },
  })
}

/**
 * Whether one HTTP request arrives over the loopback interface.
 *
 * @param req - incoming request.
 * @returns true for this machine's own connections.
 */
export function isLoopbackRequest(req) {
  const address = req?.socket?.remoteAddress
  return typeof address === 'string' && LOOPBACK_ADDRESSES.has(address)
}

/**
 * Whether a request is same-site, as far as the browser is willing to say.
 *
 * The loopback exemption below trusts this machine's own processes, and a
 * malicious page in the operator's browser IS such a process. A cross-origin
 * `fetch` is what turns that trust into a blind CSRF primitive, so the two
 * headers a browser always attaches to one are checked before the exemption is
 * granted: `Sec-Fetch-Site` is `cross-site`, or `Origin` names a different
 * authority than `Host`. Neither header is present on a non-browser caller
 * (the protocol launcher, curl), which is exactly who the exemption is for.
 *
 * @param req - incoming request.
 * @returns true when the request may be treated as same-site.
 */
export function isSameSiteRequest(req) {
  const headers = req?.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false
  const origin = headers.origin
  // A missing Origin is a non-browser caller — the protocol launcher and curl
  // send none — which is exactly who the loopback exemption is for. A literal
  // `null` says the opposite: a browser that cannot name its own origin (a
  // sandboxed frame, a `file://` page) declared that, and it must not inherit
  // the trust the exemption grants.
  if (typeof origin !== 'string' || origin === '') return true
  if (origin === 'null') return false
  const host = headers.host
  if (typeof host !== 'string' || host === '') return true
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

/**
 * The port a page's reported origin implies, when that origin is this machine.
 *
 * The value decides where the registered protocol launcher sends its secret
 * token, so only a loopback http/https origin is accepted: neither a page nor a
 * local process may be able to re-point the registry at another host. An
 * omitted port means the scheme default, which is how the plugin has always
 * read it.
 *
 * @param origin - origin reported by the browser half.
 * @returns the port, or null when the origin is absent, malformed, or not local.
 */
export function loopbackOriginPort(origin) {
  if (typeof origin !== 'string' || origin === '') return null
  let url
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') return null
  if (url.port === '') return url.protocol === 'https:' ? 443 : 80
  const port = Number(url.port)
  return Number.isInteger(port) && port > 0 ? port : null
}

/**
 * Compare two secrets without leaking their length or content through timing.
 *
 * @param a - first secret.
 * @param b - second secret.
 * @returns true when they are equal.
 */
export function secretEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Host half entry point.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the bundle row's `config` object, used as deployment defaults.
 */
export function apply(ctx, config) {
  const file = storePath()
  const baseConfig = normalizeSettings(config)

  let loaded = readStore(file)
  let overrides = loaded.store.overrides
  if (loaded.warning !== null) ctx.logger?.warn?.(`[dsh-workspace-plus/notice] ${loaded.warning}`)

  /** Current effective settings. */
  const current = () => composeSettings(baseConfig, overrides)

  /** Token authorizing the protocol launcher; fresh per host process. */
  const token = randomUUID()

  /** The session-title service, when this composition mounts one. */
  let sessionTitle = null
  ctx.inject(['sessionTitle'], (scope) => {
    sessionTitle = scope.sessionTitle
  })

  /** Origin the browser half reported, used to learn the listen port. */
  let guiOrigin = null

  /** Command line currently written into the registry, or null. */
  let registeredCommand = null

  /** Scheme that command was written under, so a change can retire it. */
  let registeredScheme = null

  /** The last conversation the plugin announced, used by the test action. */
  let lastSessionId = null

  /** A pending "open this conversation" intent, consumed by the browser half. */
  let pendingOpen = null

  /** Turn start times, so a finished turn can report how long it took. */
  const turnStartedAt = new Map()

  /**
   * Last announcement time per tag, carrying the conversation it belongs to.
   *
   * The tag is a digest (`<kind>-<hash>`), so a session cannot be recovered from
   * a key: the session id is recorded beside the timestamp for the disposal
   * prune below.
   */
  const lastAnnouncedAt = new Map()

  const daemon = new ToastDaemon({
    appId: current().appId,
    log: (message) => ctx.logger?.info?.(message),
  })

  // --- session lookup -------------------------------------------------------

  /**
   * The live session behind an agent reference.
   *
   * The `Agent` type the event contracts publish is only `{ id }`, but the
   * event's own payload carries the live agent; the session store is the
   * fallback for a composition that publishes a narrower agent object.
   *
   * @param agent - agent reference from an event payload.
   * @returns the live session, or undefined.
   */
  const sessionOf = (agent) => {
    const direct = agent?.session
    if (direct !== undefined && direct !== null) return direct
    const id = agent?.id
    if (id === undefined || id === null) return undefined
    return ctx.get('sessions')?.get(id)
  }

  /**
   * The conversation label used by a notification.
   *
   * @param session - live session.
   * @returns `{ id, title, cwd }`.
   */
  const infoOf = (session) => ({
    id: session === undefined || session === null ? '' : String(session.id),
    title: sessionTitle?.get?.(session)?.title ?? '',
    cwd: session?.header?.cwd,
  })

  // --- notification dispatch ------------------------------------------------

  /**
   * The activation a notification should carry.
   *
   * With a working protocol registration the click can name the conversation.
   * Without one it must still do something, so it degrades to `dsh://open` —
   * the desktop application's own protocol, which brings its window forward.
   * A notification whose click does nothing at all would be worse than one that
   * only raises the window.
   *
   * @param settings - effective settings.
   * @param sessionId - conversation to open.
   * @param kind - notification class.
   * @returns the protocol URL for the toast's activation.
   */
  const activationFor = (settings, sessionId, kind) =>
    settings.registerProtocol === true && registeredCommand !== null
      ? openUrl(settings.scheme, sessionId, kind)
      : 'dsh://open'

  /**
   * Raise one notification, after applying the settings that gate it.
   *
   * @param descriptor - wording produced by `format.js`, or null to skip.
   * @param session - the conversation it is about.
   * @param requestId - identity of the pending request, when the caller has one.
   *   Two approvals can be outstanding at once in one conversation (parallel tool
   *   calls), and Windows replaces a toast that reuses a tag — so without this a
   *   second request would silently overwrite the first, and answering the first
   *   would withdraw the notification for the request that is still waiting.
   * @returns `{ tag, shown }` where `shown` resolves with the send ack, or null
   *   when nothing was shown (disabled, throttled, or out of scope).
   */
  const announce = (descriptor, session, requestId) => {
    if (descriptor === null || descriptor === undefined) return null
    const settings = current()
    if (!settings.enabled) return null
    if (settings.kinds[descriptor.kind] !== true) return null
    if (!isInScope(session?.header, settings.scope)) return null

    const sessionId = session === undefined || session === null ? '' : String(session.id)
    // Windows rejects a toast tag longer than 64 characters — measured on this
    // machine, 64 is accepted and 69 throws 0x803E0209 — and a rejected tag is
    // swallowed, leaving a notification that can never be withdrawn. A real
    // session id is already `session-<uuid>` (44 characters), so the tag is
    // derived through a fixed-width digest rather than concatenated.
    const tag = toastTag(descriptor.kind, sessionId, requestId)
    const now = Date.now()
    const previous = lastAnnouncedAt.get(tag)
    if (previous !== undefined && now - previous.at < MIN_REPEAT_MS) return null
    lastAnnouncedAt.set(tag, { at: now, sessionId })
    // The map is pruned when a session is disposed, and this sweep covers the
    // sessions the host never disposes: a long-lived host that disposes nothing
    // still cannot grow it without bound, because every entry is refreshed
    // rather than appended.
    if (lastAnnouncedAt.size > 512) {
      for (const [key, entry] of lastAnnouncedAt) {
        if (now - entry.at > 60_000) lastAnnouncedAt.delete(key)
      }
    }
    lastSessionId = sessionId === '' ? lastSessionId : sessionId

    const shown = daemon
      .show({
        title: descriptor.title,
        session: descriptor.session,
        detail: descriptor.detail,
        launch: activationFor(settings, sessionId, descriptor.kind),
        tag,
        silent: settings.sound !== true,
        duration: settings.duration,
      })
      .catch((error) => {
        ctx.logger?.warn?.(`[dsh-workspace-plus/notice] ${String((error && error.message) || error)}`)
        return { ok: false, error: String((error && error.message) || error) }
      })
    return { tag, shown }
  }

  /**
   * Withdraw the notification raised for a request that has now been answered.
   *
   * The AUMID has to come from the `show` ack rather than from the daemon's
   * current identity: `show()` may have fallen back to another candidate, and a
   * toast filed under one identity cannot be removed under another. Waiting for
   * the ack also means the removal cannot race the show.
   *
   * @param raised - the value `announce` returned, or null when nothing was shown.
   * @returns nothing.
   */
  const withdraw = (raised) => {
    if (raised === null) return
    void raised.shown
      .then((ack) => (ack.ok === true ? daemon.remove(raised.tag, ack.appId) : undefined))
      .catch(() => {})
  }

  // --- 1. a tool call is waiting for a permission decision ------------------
  // A waterfall listener, and it MUST be prepended. A waterfall is dispatched
  // first-registered-first, and the first listener is outermost: the shipped
  // `@deepseek-ai/dsh-api-remotes` forwarder registers at host load (long before
  // any bundle row) and, when the desktop page answers, resolves the request
  // WITHOUT calling `next()`. Registered at the tail, this listener would simply
  // never run while the GUI is open — which is exactly the case it exists for.
  // Prepended, it observes the request first and then delegates unchanged, so
  // the decision still belongs entirely to the composed answerers. The toast is
  // withdrawn once that decision is made, so Action Center does not keep a
  // request that has already been answered.
  ctx.on(
    'approval/request',
    async (req, next) => {
      let raised = null
      try {
        const session = sessionOf(req?.agent)
        raised = announce(
          describeApproval({
            info: infoOf(session),
            toolName: req?.toolName,
            reason: req?.reason,
            displayReason: req?.displayReason,
          }),
          session,
          req?.callId,
        )
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-workspace-plus/notice] 权限通知失败：${String((error && error.message) || error)}`)
      }
      try {
        return await next()
      } finally {
        withdraw(raised)
      }
    },
    { prepend: true },
  )

  // --- 2. the model asked the user a question ------------------------------
  // Prepended for the same reason as the approval listener above.
  ctx.on(
    'user-questions/request',
    async (request, next) => {
      let raised = null
      try {
        const session = sessionOf(request?.agent)
        raised = announce(
          describeQuestion({ info: infoOf(session), questions: request?.questions }),
          session,
          request?.wait?.callId,
        )
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-workspace-plus/notice] 提问通知失败：${String((error && error.message) || error)}`)
      }
      try {
        return await next()
      } finally {
        withdraw(raised)
      }
    },
    { prepend: true },
  )

  // --- 3. turns end: finished, interrupted, or failed ----------------------
  ctx.on('session/event', (session, event) => {
    if (event === null || typeof event !== 'object') return
    const sessionId = String(session?.id ?? '')
    try {
      if (event.type === 'turn/start') {
        turnStartedAt.set(sessionId, Date.now())
        return
      }
      if (event.type !== 'turn/end') return
      const startedAt = turnStartedAt.get(sessionId)
      turnStartedAt.delete(sessionId)
      const durationMs = startedAt === undefined ? undefined : Date.now() - startedAt

      const descriptor = describeTurnEnd({ info: infoOf(session), reason: event.data?.reason, durationMs })
      if (descriptor === null) return
      if (descriptor.kind === 'done' && durationMs !== undefined && durationMs < current().minTurnMs) return
      announce(descriptor, session)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-workspace-plus/notice] 任务状态通知失败：${String((error && error.message) || error)}`)
    }
  })

  // --- 4. the agent failed outside a durable turn position -----------------
  ctx.on('agent/error', (payload) => {
    try {
      const session = sessionOf(payload?.agent)
      announce(describeAgentError({ info: infoOf(session), error: payload?.error }), session)
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-workspace-plus/notice] 错误通知失败：${String((error && error.message) || error)}`)
    }
  })

  /** A disposed session must not leave bookkeeping behind. */
  ctx.on('session/disposed', (session) => {
    const sessionId = String(session?.id ?? '')
    turnStartedAt.delete(sessionId)
    for (const [tag, entry] of [...lastAnnouncedAt]) {
      if (entry.sessionId === sessionId) lastAnnouncedAt.delete(tag)
    }
  })

  // --- the protocol registration -------------------------------------------

  /**
   * The loopback port the launcher must call, once it is known.
   *
   * The listen port is not published on any service the plugin can read with
   * certainty, so it is resolved from the most authoritative source that exists
   * at the time:
   *
   *   1. the service that owns the listener. `ctx.webServer.port` is the port
   *      actually bound, and it is the only source available before a page has
   *      spoken. It matters because a `0` port means "let the OS pick": the
   *      desktop application launches the profile with `--port 0` and reads the
   *      real port back from this same service, so the startup value below is a
   *      request, not an answer, and is 0 there.
   *   2. the origin the browser half reported, which is the address the page was
   *      actually served from. It is validated by `loopbackOriginPort` before it
   *      is adopted.
   *   3. the startup value, for a caller that passed `--port` explicitly.
   *
   * The launcher always calls 127.0.0.1: the click happens on this machine, and
   * a Harness bound to every interface still answers on loopback.
   *
   * @returns the port, or null while no source knows one.
   */
  const listenPort = () => {
    const bound = Number(ctx.get('webServer')?.port)
    if (Number.isInteger(bound) && bound > 0) return bound
    const reported = loopbackOriginPort(guiOrigin)
    if (reported !== null) return reported
    const port = ctx.get('webStartup')?.port
    if (typeof port === 'number' && Number.isInteger(port) && port > 0) return port
    return null
  }

  /**
   * One synchronous-ish pass over the registry. Callers use `syncProtocol`.
   *
   * @returns the outcome for the settings page.
   */
  const syncProtocolNow = async () => {
    const settings = current()
    const scheme = settings.scheme

    /** Retire a registration this plugin owns under a scheme it no longer uses. */
    const retireOldScheme = async () => {
      if (registeredScheme === null || registeredScheme === scheme) return
      const previous = registeredScheme
      const previousCommand = registeredCommand
      registeredScheme = null
      registeredCommand = null
      const stored = await readProtocolCommand(previous)
      if (previousCommand === null || stored === previousCommand) await unregisterProtocol(previous)
    }

    if (!isSupported()) return { ok: false, message: '仅 Windows 支持协议跳转' }
    if (settings.registerProtocol !== true) {
      await retireOldScheme()
      if (registeredCommand !== null) {
        await unregisterProtocol(scheme)
        registeredCommand = null
        registeredScheme = null
      }
      return { ok: true, message: '已关闭协议注册：点击通知只会把 Harness 窗口切到前台' }
    }
    const port = listenPort()
    if (port === null) return { ok: false, message: '尚未获知 Harness 监听端口，稍后重试' }
    await retireOldScheme()

    const command = protocolCommand({
      powershell: powershellPath(),
      script: CLICK_SCRIPT,
      scheme,
      port,
      token,
    })
    const stored = await readProtocolCommand(scheme)
    if (stored === command) {
      registeredCommand = command
      registeredScheme = scheme
      return { ok: true, message: `${scheme}: 已注册` }
    }
    const result = await registerProtocol({ scheme, command })
    registeredCommand = result.ok ? command : null
    registeredScheme = result.ok ? scheme : null
    return result
  }

  /** Tail of the serialization chain, so registry writes never interleave. */
  let protocolChain = Promise.resolve()

  /**
   * Make the registry match the current settings and listen port.
   *
   * Idempotent on purpose: it is called at load, whenever the user changes the
   * settings, and whenever the browser half reports a new origin. It reads the
   * stored command first, so a steady state costs one `reg query` and no write.
   *
   * A scheme the user changed has to be retired explicitly. Leaving the old key
   * behind would keep a protocol registered that points at this plugin's
   * launcher with a token from a previous process — a click on any older
   * notification would then reach a route that rejects it.
   *
   * Every run is serialized behind the previous one. The bookkeeping
   * (`registeredCommand`/`registeredScheme`) is assigned after `await`s, and the
   * four call sites genuinely race — a page reporting its origin while the user
   * flips a switch would otherwise be able to leave the variables describing a
   * registry state that no longer exists, or an orphaned key behind.
   *
   * @returns the outcome for the settings page.
   */
  const syncProtocol = () => {
    const run = protocolChain.then(syncProtocolNow, syncProtocolNow)
    protocolChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // --- HTTP routes ----------------------------------------------------------

  /**
   * Admit one request, mirroring the Harness's own browser trust checks.
   *
   * `connection.admit` applies the Host fence and the browser session cookie to
   * a plugin route. A loopback request that it refuses is still allowed: the
   * machine's own processes are the operator, and a page that has not completed
   * its token login must not lose the ability to read plugin state.
   *
   * The exemption is granted only to a request that is not visibly cross-site,
   * because loopback is not a trust boundary against the operator's own browser:
   * a hostile page can reach 127.0.0.1, and for a state-changing request that
   * would be a blind CSRF primitive. `Sec-Fetch-Site`/`Origin` close it, and a
   * JSON content type is required for writes so a cross-origin attempt cannot
   * even be a CORS "simple request" — it has to preflight, and the preflight is
   * refused.
   *
   * @param req - incoming request.
   * @param res - response to write a refusal to.
   * @returns true when the handler may run.
   */
  const admitted = (req, res) => {
    const refuse = (status) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(status === 401 ? 'unauthorized' : 'forbidden')
      return false
    }
    if (!isSameSiteRequest(req)) return refuse(403)

    const writes = req.method !== undefined && req.method !== 'GET' && req.method !== 'HEAD'
    if (writes) {
      const type = String(req?.headers?.['content-type'] ?? '').toLowerCase()
      if (!type.startsWith('application/json')) return refuse(403)
    }

    const connection = ctx.get('connection')
    const result = connection?.admit?.(req)
    if (result !== undefined && 'rejection' in result && result.rejection !== undefined) {
      if (!isLoopbackRequest(req)) return refuse(result.rejection)
    }
    return true
  }

  /**
   * Write one JSON response.
   *
   * @param res - response.
   * @param status - HTTP status.
   * @param payload - serializable body.
   * @returns nothing.
   */
  const sendJson = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  /**
   * Read a bounded JSON request body.
   *
   * An over-long body is DRAINED rather than abandoned. Leaving the `for await`
   * early calls the iterator's `return()`, which destroys the request — and a
   * destroyed socket swallows the 413 that was supposed to explain the refusal,
   * so the client sees a connection reset instead. The drain is itself bounded,
   * because a caller determined to stream gigabytes at a notification route has
   * forfeited the courtesy of an answer.
   *
   * @param req - incoming request.
   * @returns the parsed body, or an error marker.
   */
  const readBody = async (req) => {
    const chunks = []
    let bytes = 0
    let tooLarge = false
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        if (!tooLarge) {
          tooLarge = true
          chunks.length = 0
        }
        if (bytes > DRAIN_CAP_BYTES) break
        continue
      }
      chunks.push(chunk)
    }
    if (tooLarge) return { error: 'request body too large' }
    try {
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    } catch {
      return { error: 'body is not JSON' }
    }
  }

  /** Snapshot the browser half and the settings page read. */
  const snapshot = () => {
    const settings = current()
    return {
      ok: true,
      settings,
      defaults: normalizeSettings({}),
      base: baseConfig,
      overrides,
      kinds: KINDS.map((kind) => ({ id: kind, label: KIND_LABELS[kind], enabled: settings.kinds[kind] === true })),
      toast: daemon.status(),
      // The registered command line embeds the launcher's token, which is the
      // credential for the open route. The page only needs to know WHETHER the
      // registration is current, so the command itself never leaves the host.
      protocol: {
        scheme: settings.scheme,
        registeredScheme,
        registered: registeredCommand !== null,
        port: listenPort(),
      },
      platformSupported: isSupported(),
      lastSessionId,
    }
  }

  // --- 4. the browser half's routes ----------------------------------------
  ctx.inject(['webServer'], (webCtx) => {
    const register = (path, handler) =>
      webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path, handler }), `dsh-workspace-plus/notice: ${path}`)

    register(API_PATH, async (req, res) => {
      if (!admitted(req, res)) return
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const reported = url.searchParams.get('origin')
          // Only an origin that names this machine is kept: it sets the port the
          // registered launcher will send its token to, and a page — or any local
          // process that can reach this route — must not be able to move it.
          const accepted = loopbackOriginPort(reported) === null ? null : reported
          if (accepted !== null && accepted !== guiOrigin) {
            guiOrigin = accepted
            void syncProtocol().catch(() => {})
          }
          sendJson(res, 200, snapshot())
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readBody(req)
        if (body.error !== undefined) {
          sendJson(res, 400, { ok: false, message: body.error })
          return
        }
        const payload = body.value !== null && typeof body.value === 'object' ? body.value : {}
        const op = payload.op

        if (op === 'test') {
          const settings = current()
          const launch = activationFor(settings, lastSessionId ?? 'test', 'approval')
          const ack = await daemon.show({
            title: '这是一条测试通知',
            session: lastSessionId === null ? 'dsh-notice' : '点击可打开最近的对话',
            detail: '通知类型、声音与点击跳转都已按当前设置发送',
            launch,
            tag: 'test:approval',
            silent: settings.sound !== true,
            duration: settings.duration,
          })
          sendJson(res, 200, {
            ...snapshot(),
            ok: ack.ok === true,
            message: ack.ok === true ? '已发送测试通知' : String(ack.error ?? '发送失败'),
          })
          return
        }

        if (op === 'registerProtocol' || op === 'unregisterProtocol') {
          if (op === 'unregisterProtocol') {
            const result = await unregisterProtocol(current().scheme)
            registeredCommand = null
            registeredScheme = null
            sendJson(res, 200, { ...snapshot(), ok: true, message: result.message })
            return
          }
          const result = await syncProtocol()
          sendJson(res, 200, { ...snapshot(), ...result })
          return
        }

        if (op === 'patch' || op === 'clear') {
          // `clear` without a key means "restore every default": the overrides
          // object IS the diff from the bundle config, so dropping it is the
          // whole operation — nothing has to remember what the defaults were.
          overrides =
            op === 'patch'
              ? mergeOverrides(overrides, payload.patch)
              : payload.key === undefined || payload.key === null
                ? {}
                : clearOverride(overrides, payload.key)
          const written = writeStore(file, { version: loaded.store.version, overrides })
          if (!written.ok) {
            sendJson(res, 500, { ...snapshot(), ok: false, message: written.message })
            return
          }
          daemon.setAppId(current().appId)
          void syncProtocol().catch(() => {})
          sendJson(res, 200, snapshot())
          return
        }

        if (op !== undefined) {
          sendJson(res, 400, { ok: false, message: `unknown op: ${String(op)}` })
          return
        }
        sendJson(res, 200, snapshot())
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-workspace-plus/notice] ${String((error && error.message) || error)}`)
        sendJson(res, 500, { ok: false, message: String((error && error.message) || error) })
      }
    })

    register(OPEN_PATH, async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        if (!secretEquals(url.searchParams.get('token') ?? '', token)) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
          res.end('forbidden')
          return
        }
        const activated = url.searchParams.get('url') ?? ''
        let sessionId = ''
        // `searchParams.get('url')` has already percent-decoded once, so the
        // activated URL must be parsed as a URL rather than decoded again: a
        // second `decodeURIComponent` would turn `%2541` into `A`. A scheme
        // Windows hands over verbatim may still not parse, hence the fallback to
        // the route's own `s` parameter.
        if (activated !== '') {
          try {
            sessionId = new URL(activated).searchParams.get('s') ?? ''
          } catch {
            sessionId = ''
          }
        }
        if (sessionId === '') sessionId = url.searchParams.get('s') ?? ''

        pendingOpen = { sessionId, at: Date.now() }
        const settings = current()
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end('ok')
        if (settings.focusOnClick === true) void focusDesktopWindow().catch(() => {})
      } catch (error) {
        ctx.logger?.warn?.(`[dsh-workspace-plus/notice] ${String((error && error.message) || error)}`)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('error')
      }
    })

    register(PENDING_PATH, (req, res) => {
      if (!admitted(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, message: 'method not allowed' })
        return
      }
      const fresh = pendingOpen !== null && Date.now() - pendingOpen.at <= PENDING_TTL_MS ? pendingOpen : null
      pendingOpen = null
      sendJson(res, 200, { ok: true, sessionId: fresh === null ? null : fresh.sessionId })
    })
  })

  // --- start-up and teardown ------------------------------------------------

  // The toast daemon is started by the first notification rather than here: it
  // holds the host's event loop while it runs (see `ToastDaemon`), so a profile
  // command that loads this plugin and exits must not spawn one. The protocol
  // registration, by contrast, is cheap and idempotent and runs now.
  void syncProtocol()
    .then((result) => {
      if (result.ok !== true) ctx.logger?.info?.(`[dsh-workspace-plus/notice] ${result.message}`)
    })
    .catch(() => {})

  const releaseProtocol = () => {
    const owned = registeredCommand
    const scheme = registeredScheme
    registeredCommand = null
    registeredScheme = null
    if (owned === null || scheme === null) return
    void readProtocolCommand(scheme)
      .then((stored) => {
        // Only remove a registration this plugin still owns: a user who
        // re-pointed the scheme at something else keeps their version.
        if (stored === null || stored !== owned) return
        return unregisterProtocol(scheme)
      })
      .catch(() => {})
  }

  ctx.effect(
    () => () => {
      daemon.stop()
      releaseProtocol()
    },
    'dsh-workspace-plus/notice: toast daemon and protocol registration',
  )

  ctx.logger?.info?.(
    `[dsh-workspace-plus/notice] 已加载：${isSupported() ? 'Windows 原生通知' : '当前平台不支持通知'}，` +
      `类型 ${KINDS.filter((kind) => current().kinds[kind] === true).join('/')}`,
  )
}
