/**
 * dsh-workspace-plus / sessionlog — host half.
 *
 * DSH ships an "在使用官方模型 API 时上传 Session Log" preference whose whole
 * delivery path hangs off the **official DeepSeek adapter**: the host plugin
 * `@deepseek-ai/dsh-session-log-deepseek` registers a `dsh_session_log` field on
 * the `deepseekLlmApiExtensions` registry, and only `dsh-llm-deepseek`'s
 * `/messages` request ever carries it. A user whose active model provider is
 * something else therefore uploads nothing at all — there is no request to
 * attach the field to.
 *
 * This sub-feature reproduces that behaviour and closes the gap. It has two
 * independent channels, both gated by one switch that ships **OFF**:
 *
 *   1. **OTLP session-log channel (primary).** It observes the canonical session
 *      stream (`session/created`, `session/event`) and hands one record per
 *      event to its own byte-bounded channel created through the public
 *      `ctx.otel.createSessionLogReporter(...)`. That transport is owned by
 *      DSH, carries batching/retry/shutdown, and — crucially — does not care
 *      which model adapter is in play. It posts to the DeepSeek-operated
 *      collector the base profile already uses for its own session telemetry.
 *   2. **`dsh_session_log` request field (parity fallback).** When the official
 *      DeepSeek adapter is the one performing the request *and* no other plugin
 *      already owns that field (in a shipped profile the built-in package does),
 *      this half contributes the field in the shipped v1 wire format. It is a
 *      fallback for compositions that drop the built-in package, not a second
 *      copy of the primary channel.
 *
 * Nothing here imports anything but Node builtins and sibling files, and the
 * whole thing reads no credentials: the collector endpoint is a public ingest
 * URL, and the only identity attached is the Harness home's anonymous UUID.
 *
 * @module dsh-workspace-plus/sessionlog
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENDPOINT_ENV,
  MAX_REQUEST_BYTES_CEILING,
  MAX_SHUTDOWN_TIMEOUT_MILLIS,
  SETTING_KEYS,
  anonymousUserId,
  coerceBoolean,
  coerceCount,
  composeSettings,
  defaultSettings,
  normalizeEndpoint,
  normalizeSettings,
  readStore,
  resolveEndpoint,
  storePath,
  telemetryKillSwitch,
  uploadBlockedBy,
  writeStore,
} from './settings.js'
import {
  REQUEST_FIELD,
  SCOPE_NAME,
  buildRequestField,
  sessionLogRecord,
} from './wire.js'
import { detectCredentialShapes } from './redact.js'

/** Loader row module name; must stay in step with the `./sessionlog` export. */
export const name = 'dsh-workspace-plus/sessionlog'

/** Same-origin JSON route the browser half reads and writes. */
export const API_PATH = '/dsh-sessionlog/api'

/** Request-body ceiling, matching the plugin's other two routes. */
const MAX_BODY_BYTES = 64 * 1024

/** `service.name` reported to the collector, matching DSH's own telemetry. */
export const SERVICE_NAME = 'deepseek-harness'

/** Where the request-field channel currently stands, for the settings page. */
export const REQUEST_FIELD_STATES = Object.freeze(['active', 'taken', 'unavailable', 'disabled'])

/**
 * Read this package's version. `files` publishes `lib/`, so the root manifest
 * is always two directories up in an installed bundle.
 *
 * @returns the version string, or `'0.0.0'` when it cannot be read.
 */
export function pluginVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const manifest = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Host entry point.
 *
 * @param ctx - Cordis host context.
 * @param config - the loader row's `config:` block (deployment defaults).
 */
export function apply(ctx, config) {
  const file = storePath()
  const base = normalizeSettings(config)
  const loaded = readStore(file)
  let overrides = loaded.overrides
  let accepted = loaded.accepted
  if (loaded.warning !== null) ctx.logger?.warn?.(`[${name}] ${loaded.warning}`)

  /**
   * Effective settings, cached. `report()` runs on the session-event firehose,
   * so recomposing (and re-parsing the endpoint URL) per event would put
   * avoidable work on the append path; `refresh()` is the one invalidation
   * point, called at load and after every accepted settings write.
   */
  let effective = composeSettings(base, overrides)
  let effectiveEndpoint = resolveEndpoint(effective, process.env)

  /** @returns the cached effective settings. */
  const current = () => effective

  /** Recompute the cached settings after a write. */
  function refresh() {
    effective = composeSettings(base, overrides)
    effectiveEndpoint = resolveEndpoint(effective, process.env)
  }

  /** Per-session high-water mark of what this process has already handed over. */
  const cursor = new WeakMap()

  /** Observable counters surfaced on the settings page. */
  const stats = {
    startedAt: Date.now(),
    events: 0,
    sessions: 0,
    lastEventAt: null,
    lastAcceptAt: null,
    lastError: null,
    lastErrorAt: null,
    /** Credential shapes scrubbed out of outbound events, and when the last one was. */
    redactions: 0,
    lastRedactionAt: null,
  }

  const recordError = (message) => {
    stats.lastError = message
    stats.lastErrorAt = Date.now()
  }

  // --- Channel 1: the provider-independent OTLP session-log channel ---------

  /** The `otel` service, once the composition provides it. */
  let otelScope = null
  /** The channel this plugin owns; `null` while uploading is off or unavailable. */
  let reporter = null
  /** Endpoint the live channel was built for, so a change rebuilds it. */
  let reporterEndpoint = null
  /** Where the request-field channel stands; the page renders this. */
  let requestFieldState = 'disabled'
  /** Why the request-field channel is not active, when it is not. */
  let requestFieldError = null

  /**
   * Drain and release the current channel. The channel is detached first so a
   * concurrent `ensureReporter` can never hand work to a channel that is on its
   * way out.
   */
  async function shutdownReporter() {
    const active = reporter
    reporter = null
    reporterEndpoint = null
    if (active === null) return
    const deadline = current().shutdownTimeoutMillis
    let timer
    try {
      await Promise.race([
        Promise.resolve(active.shutdown()),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            try {
              active.stopPending?.()
            } catch {
              /* the channel is being abandoned; nothing useful to do with this */
            }
            reject(new Error(`provider shutdown exceeded ${deadline}ms`))
          }, deadline)
        }),
      ])
    } catch (error) {
      const message = String((error && error.message) || error)
      ctx.logger?.warn?.(`[${name}] upload channel shutdown: ${message}`)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /**
   * Materialize the channel for the current settings, reusing it when neither
   * enablement nor endpoint changed.
   *
   * @returns the channel to report into, or `null` when uploading is off or
   *   `ctx.otel` is not mounted.
   */
  function ensureReporter() {
    const settings = current()
    if (uploadBlockedBy(settings) !== null) {
      void shutdownReporter()
      return null
    }
    if (otelScope === null || typeof otelScope.otel?.createSessionLogReporter !== 'function') return null
    const endpoint = effectiveEndpoint
    if (reporter !== null && reporterEndpoint === endpoint) return reporter
    void shutdownReporter()
    try {
      reporter = otelScope.otel.createSessionLogReporter({
        scope: { name: SCOPE_NAME, version: pluginVersion() },
        exporter: { url: endpoint, compression: 'gzip', timeoutMillis: 1000 },
        processor: {
          scheduledDelayMillis: 10000,
          maxQueueSize: 2048,
          maxExportBatchSize: 2048,
          exportTimeoutMillis: 1500,
        },
        maxRequestBytes: settings.maxRequestBytes,
        resourceAttributes: {
          'service.name': SERVICE_NAME,
          'service.version': typeof process.env.DSH_CLIENT_VERSION === 'string' && process.env.DSH_CLIENT_VERSION !== '' ? process.env.DSH_CLIENT_VERSION : 'unknown',
          'user.id': anonymousUserId(),
          'dsh.plugin': name,
        },
        onFailure: (message, error) => {
          recordError(`${String(message)}${error === undefined ? '' : `: ${String((error && error.message) || error)}`}`)
          ctx.logger?.warn?.(`[${name}] ${message}`, error)
        },
      })
      reporterEndpoint = endpoint
      ctx.logger?.info?.(`[${name}] 会话日志上传已开启 → ${endpoint}`)
    } catch (error) {
      const message = String((error && error.message) || error)
      recordError(`创建上传通道失败：${message}`)
      ctx.logger?.warn?.(`[${name}] 创建上传通道失败：${message}`)
      reporter = null
      reporterEndpoint = null
      return null
    }
    return reporter
  }

  /**
   * Hand one canonical event to the live channel, advancing the in-process
   * cursor only after the handoff succeeded.
   *
   * @param session - the owning Session.
   * @param event - the canonical event.
   */
  function report(session, event) {
    if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return
    if (uploadBlockedBy(current()) !== null) return
    const active = ensureReporter()
    if (active === null) return
    const seq = Number(event.seq)
    if (!Number.isSafeInteger(seq)) return
    const seen = cursor.get(session)
    if (typeof seen === 'number' && seq <= seen) return
    try {
      // Redaction happens inside the wire layer, so no outbound path can skip it.
      // Counting here is the only way the settings page can prove it is working.
      const shapes = detectCredentialShapes(event.data)
      if (shapes.length > 0) {
        stats.redactions += shapes.length
        stats.lastRedactionAt = Date.now()
      }
      active.reportSessionLog(sessionLogRecord(session, event))
      cursor.set(session, seq)
      stats.events += 1
      stats.lastEventAt = Date.now()
    } catch (error) {
      recordError(String((error && error.message) || error))
    }
  }

  /**
   * Replay the canonical log from one offset through the same path a live event
   * takes, so ordering and de-duplication stay identical.
   *
   * @param session - the Session to replay.
   * @param fromSeq - inclusive first sequence to send.
   */
  function replay(session, fromSeq) {
    if (typeof session.snapshotEvents !== 'function') return
    for (const event of session.snapshotEvents(fromSeq)) report(session, event)
  }

  /**
   * Start following one Session. A Session this process has never seen begins
   * either at its first lifecycle event (the default) or at sequence 0 when
   * history upload is on.
   *
   * @param session - the live Session.
   */
  function adoptLive(session) {
    if (cursor.has(session)) return
    const settings = current()
    if (uploadBlockedBy(settings) !== null) return
    const first = Number(session.firstLifecycleSeq ?? 0)
    const start = settings.includeHistory === true ? 0 : first
    cursor.set(session, start - 1)
    stats.sessions += 1
    replay(session, start)
  }

  /**
   * Sweep the Sessions that are already live. This is what makes turning the
   * switch on mid-run behave like a restart: sessions created before the plugin
   * (or before the switch) are picked up instead of silently skipped.
   */
  function adoptExisting() {
    const settings = current()
    if (uploadBlockedBy(settings) !== null) return
    if (typeof ctx.sessions?.list !== 'function') return
    for (const session of ctx.sessions.list()) {
      if (cursor.has(session)) continue
      const start = settings.includeHistory === true ? 0 : Number(session.seq)
      cursor.set(session, start - 1)
      stats.sessions += 1
      replay(session, start)
    }
  }

  /** Re-evaluate enablement after a settings write. */
  function afterSettingsChange() {
    if (uploadBlockedBy(current()) === null) {
      ensureReporter()
      adoptExisting()
      return
    }
    void shutdownReporter()
  }

  ctx.inject(['otel'], (scope) => {
    otelScope = scope
    afterSettingsChange()
  })

  // --- Channel 2: the `dsh_session_log` request field -----------------------

  /**
   * Highest sequence the provider already accepted for this exact Session
   * format generation, or `-1` before any accepted request. A mismatch in
   * format generation discards the watermark rather than resending a range the
   * provider would reinterpret.
   *
   * @param session - the Session the request carries.
   * @returns the exclusive lower bound for the next upload.
   */
  function watermarkFor(session) {
    const entry = accepted[String(session.id)]
    if (entry === undefined) return -1
    if (entry.formatVersion !== Number(session.header?.version ?? 0)) return -1
    return entry.throughSeq
  }

  /**
   * Prepare the request field for one official DeepSeek request. Returning
   * `undefined` means "this request carries no field", which is the honest
   * answer whenever uploading is off, the Session is not live, or nothing new
   * fits the byte ceiling.
   *
   * @param request - the adapter's prepared request facts.
   * @returns `{ value, accept }`, or `undefined`.
   */
  function prepareRequestField(request) {
    const settings = current()
    if (uploadBlockedBy(settings) !== null || settings.requestField !== true) return undefined
    if (request === null || typeof request !== 'object' || request.sessionId === undefined) return undefined
    const session = ctx.sessions?.get?.(request.sessionId)
    if (session === undefined || session === null) return undefined
    const built = buildRequestField({
      session,
      afterSeq: watermarkFor(session),
      maxBytes: settings.maxRequestBytes,
    })
    if (built === undefined) return undefined
    return {
      value: built.value,
      accept: () => {
        accepted = {
          ...accepted,
          [String(session.id)]: {
            formatVersion: Number(session.header?.version ?? 0),
            throughSeq: built.throughSeq,
          },
        }
        const written = writeStore(file, { overrides, accepted })
        if (!written.ok) {
          recordError(`保存接受水位失败：${written.message}`)
          ctx.logger?.warn?.(`[${name}] 保存接受水位失败：${written.message}`)
        }
        stats.lastAcceptAt = Date.now()
      },
    }
  }

  ctx.inject(['deepseekLlmApiExtensions'], (scope) => {
    const registry = scope.deepseekLlmApiExtensions
    if (registry === undefined || typeof registry.register !== 'function') {
      requestFieldState = 'unavailable'
      requestFieldError = '当前组合里没有 deepseekLlmApiExtensions 服务'
      return
    }
    // The shipped `@deepseek-ai/dsh-session-log-deepseek` registers this exact
    // field at load time, and the registry throws on a duplicate. Detect the
    // owner first so a shipped profile never turns this fallback into a load
    // failure; the primary OTLP channel covers those profiles anyway.
    if (registry.providers?.has?.(REQUEST_FIELD) === true) {
      requestFieldState = 'taken'
      requestFieldError = `${REQUEST_FIELD} 已由其它插件提供（通常是 @deepseek-ai/dsh-session-log-deepseek）；请求字段这一路自动跳过`
      ctx.logger?.info?.(`[${name}] ${requestFieldError}`)
      return
    }
    try {
      scope.effect(
        () => registry.register(REQUEST_FIELD, { prepare: prepareRequestField }),
        `${name}: register(${REQUEST_FIELD})`,
      )
      requestFieldState = 'active'
      requestFieldError = null
    } catch (error) {
      requestFieldState = 'unavailable'
      requestFieldError = String((error && error.message) || error)
      ctx.logger?.warn?.(`[${name}] 注册 ${REQUEST_FIELD} 失败：${requestFieldError}`)
    }
  })

  // --- Follow the canonical session stream ---------------------------------

  ctx.inject(['sessions'], (scope) => {
    scope.on('session/created', (session) => {
      try {
        adoptLive(session)
      } catch (error) {
        recordError(String((error && error.message) || error))
      }
    })
    scope.on('session/event', (session, event) => {
      // Every listener runs inside Cordis' stop-on-throw emit, so a failure
      // here would starve later subscribers; report() already contains its own.
      try {
        report(session, event)
      } catch (error) {
        recordError(String((error && error.message) || error))
      }
    })
    scope.on('session/disposed', (session) => {
      cursor.delete(session)
    })
    adoptExisting()
  })

  // --- The browser half's same-origin JSON endpoint ------------------------

  /**
   * Everything the settings page renders.
   *
   * @returns a JSON-safe snapshot.
   */
  const snapshot = () => {
    const settings = current()
    const fromEnv = typeof process.env[ENDPOINT_ENV] === 'string' ? process.env[ENDPOINT_ENV].trim() : ''
    return {
      ok: true,
      settings: { ...settings },
      defaults: defaultSettings(),
      effectiveEndpoint,
      endpointSource: settings.endpoint !== '' ? 'settings' : fromEnv !== '' ? 'environment' : 'default',
      // A process-level opt-out outranks this page's switch; the page says so
      // rather than pretending the switch it just flipped did nothing.
      killSwitch: telemetryKillSwitch(),
      blockedReason: uploadBlockedBy(settings),
      channel: {
        otlpAvailable: otelScope !== null,
        reporting: reporter !== null,
        requestField: requestFieldState,
        requestFieldError,
      },
      storePath: file,
      stats: { ...stats },
    }
  }

  /**
   * Validate and apply one settings patch. Every value is checked before
   * anything is written, and a value equal to the bundle default drops its
   * override instead of pinning it — otherwise a deployment that shipped
   * `enabled: true` could never be switched off from the page.
   *
   * @param patch - the requested keys.
   * @returns `{ ok, message, settings }`.
   */
  function applyPatch(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return { ok: false, message: 'patch 必须是对象', settings: current() }
    }
    const next = { ...overrides }
    for (const [key, value] of Object.entries(patch)) {
      if (!SETTING_KEYS.includes(key)) return { ok: false, message: `未知设置项：${key}`, settings: current() }
      if (key === 'endpoint') {
        const normalized = normalizeEndpoint(value)
        if (normalized.warning !== null) return { ok: false, message: normalized.warning, settings: current() }
        if (normalized.value === base.endpoint) delete next[key]
        else next[key] = normalized.value
        continue
      }
      if (key === 'maxRequestBytes' || key === 'shutdownTimeoutMillis') {
        const number = typeof value === 'number' ? value : Number(String(value ?? '').trim())
        if (!Number.isFinite(number) || number <= 0) {
          return { ok: false, message: `${key} 必须是正数`, settings: current() }
        }
        const ceiling = key === 'maxRequestBytes' ? MAX_REQUEST_BYTES_CEILING : MAX_SHUTDOWN_TIMEOUT_MILLIS
        const coerced = coerceCount(value, NaN, ceiling)
        if (!Number.isFinite(coerced)) return { ok: false, message: `${key} 不是合法数值`, settings: current() }
        if (coerced === base[key]) delete next[key]
        else next[key] = coerced
        continue
      }
      const coerced = coerceBoolean(value, undefined)
      if (typeof coerced !== 'boolean') {
        return { ok: false, message: `${key} 必须是布尔值`, settings: current() }
      }
      if (coerced === base[key]) delete next[key]
      else next[key] = coerced
    }
    overrides = next
    const written = writeStore(file, { overrides, accepted })
    if (!written.ok) return { ok: false, message: written.message, settings: current() }
    refresh()
    afterSettingsChange()
    return { ok: true, message: '设置已保存', settings: current() }
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: API_PATH,
          handler: async (req, res) => {
            const connection = ctx.get('connection')
            const admission = connection?.admit?.(req)
            if (admission !== undefined && 'rejection' in admission) {
              res.writeHead(admission.rejection)
              res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
              return
            }
            const send = (status, payload) => {
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(payload))
            }
            try {
              if (req.method === 'GET') {
                send(200, snapshot())
                return
              }
              if (req.method !== 'POST') {
                send(405, { ok: false, message: 'method not allowed' })
                return
              }
              const chunks = []
              let bytes = 0
              for await (const chunk of req) {
                bytes += chunk.length
                if (bytes > MAX_BODY_BYTES) {
                  // Drain before answering: a 413 that abandons the body can be
                  // swallowed by the socket teardown instead of reaching the page.
                  for await (const rest of req) void rest
                  send(413, { ok: false, message: 'request body too large', ...snapshot() })
                  return
                }
                chunks.push(chunk)
              }
              let payload
              try {
                payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              } catch {
                send(400, { ok: false, message: 'body is not JSON', ...snapshot() })
                return
              }
              if (payload?.op === 'patch') {
                const result = applyPatch(payload.patch)
                send(result.ok ? 200 : 400, { ...snapshot(), ok: result.ok, message: result.message })
                return
              }
              if (payload?.op === 'reset') {
                overrides = {}
                const written = writeStore(file, { overrides, accepted })
                if (!written.ok) {
                  send(500, { ok: false, message: written.message, ...snapshot() })
                  return
                }
                refresh()
                afterSettingsChange()
                send(200, { ...snapshot(), message: '已恢复默认' })
                return
              }
              send(400, { ok: false, message: `unknown op: ${String(payload?.op)}`, ...snapshot() })
            } catch (error) {
              const message = String((error && error.message) || error)
              recordError(message)
              ctx.logger?.warn?.(`[${name}] ${message}`)
              send(500, { ok: false, message })
            }
          },
        }),
      `${name}: ${API_PATH} route`,
    )
  })

  // --- Teardown -------------------------------------------------------------

  // The channel is owned by this fiber: unloading the row drains queued records
  // up to the configured deadline instead of dropping them outright. The async
  // disposer is awaited by Cordis, exactly like the shipped session-telemetry
  // backend's own teardown.
  ctx.effect(
    () => () => shutdownReporter(),
    `${name}: upload channel teardown`,
  )

  const settings = current()
  ctx.logger?.info?.(
    `[${name}] 已加载：上传${settings.enabled === true ? '已开启' : '默认关闭'}（${resolveEndpoint(settings, process.env)}）`,
  )
}

export { EVENT_BODY, EVENT_NAME, REQUEST_FIELD, SCOPE_NAME } from './wire.js'
