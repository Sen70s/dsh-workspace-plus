/**
 * dsh-workspace-plus/notice — the Windows toast transport (ported from dsh-notice).
 *
 * Showing a Windows toast from an unpackaged Node process means going through
 * WinRT, which Node cannot reach. Spawning `powershell.exe` once per
 * notification would work but costs a few hundred milliseconds and a fresh
 * interpreter every time a turn ends, so this module keeps ONE Windows
 * PowerShell process alive and feeds it newline-delimited JSON over stdin. The
 * first toast pays the interpreter start; every later one is a pipe write.
 *
 * The daemon is a cache, not a source of truth: if it dies it is restarted on
 * the next notification, and a restarted daemon loses nothing but the messages
 * that were in flight.
 *
 * @module dsh-workspace-plus/notice/toast
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { aumidCandidates, isSupported, powershellPath } from './win32.js'

/** Absolute path of the PowerShell daemon shipped beside this module. */
export const TOAST_HOST_SCRIPT = fileURLToPath(new URL('./toast-host.ps1', import.meta.url))

/** Group every toast of this plugin shares, so tag-scoped removal is precise. */
export const TOAST_GROUP = 'dsh-workspace-plus/notice'

/**
 * Longest notification tag Windows accepts.
 *
 * Measured on this machine with Windows PowerShell 5.1: assigning a 64-character
 * `ToastNotification.Tag` succeeds, a 69-character one throws `0x803E0209`
 * ("The size of the notification tag is too large"). The failure is invisible to
 * the user — the toast is shown without a tag — and a later `History.Remove`
 * under that tag quietly matches nothing, so the notification can never be
 * withdrawn. Nothing in this plugin may therefore build a tag by concatenation.
 */
export const MAX_TAG_LENGTH = 64

/**
 * Build the tag for one notification.
 *
 * A real DSH session id is `session-<uuid>` — 44 characters on its own — so a
 * readable `sessionId:kind:callId` tag overflows the limit as soon as a tool
 * call id joins it. The tag is therefore `kind-<16 hex>`, where the hex is a
 * digest of the session and the pending request: fixed width, stable for the
 * same request (so the withdrawal finds it), and distinct for two requests that
 * are outstanding at once in one conversation.
 *
 * @param kind - notification class.
 * @param sessionId - conversation the notification is about.
 * @param requestId - pending tool-call id, when the caller has one.
 * @returns a tag of at most {@link MAX_TAG_LENGTH} characters.
 */
export function toastTag(kind, sessionId, requestId) {
  const seed = `${String(sessionId ?? '')}\u0000${String(requestId ?? '')}`
  const digest = createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16)
  return `${String(kind ?? 'notice')}-${digest}`.slice(0, MAX_TAG_LENGTH)
}

/** Restart backoff, in milliseconds, indexed by consecutive failure count. */
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 15_000]

/** A daemon that never acknowledged anything for this long is considered dead. */
const ACK_TIMEOUT_MS = 15_000

/**
 * A supervised Windows toast daemon.
 *
 * Every method is safe to call when toasts cannot be shown at all: the class
 * reports the reason through `lastError` instead of throwing, because a plugin
 * that cannot draw a notification must still leave the Harness working.
 */
export class ToastDaemon {
  /**
   * @param options - interpreter, script, AUMID preference and diagnostics sink.
   */
  constructor(options = {}) {
    /** Windows PowerShell interpreter. */
    this.powershell = options.powershell ?? powershellPath()
    /** Daemon script. */
    this.script = options.script ?? TOAST_HOST_SCRIPT
    /** Explicit AUMID, or an empty string to let the daemon adapt. */
    this.configuredAppId = typeof options.appId === 'string' ? options.appId.trim() : ''
    /** AUMIDs still worth trying, best attribution first. */
    this.candidates = this.configuredAppId === '' ? aumidCandidates() : [this.configuredAppId]
    /** The AUMID that most recently worked. */
    this.appId = this.candidates[0]
    /** Where `appId` came from: `'configured'`, `'probe'`, or `'guess'`. */
    this.aumidSource = this.configuredAppId === '' ? 'guess' : 'configured'
    /** Explanation of the last AUMID decision, for the settings page. */
    this.probeNote = null
    /** In-flight (or settled) registration probe, so it runs at most once. */
    this.probePromise = null
    /** `node:child_process` handle while the daemon runs. */
    this.child = null
    /** Whether a spawn is in flight. */
    this.starting = false
    /**
     * Whether the daemon has ever been started in this plugin's life.
     *
     * The daemon starts lazily, so "not running" is the ordinary state until the
     * first notification. Without this the settings page would report a fresh,
     * perfectly healthy plugin as if its transport had died.
     */
    this.started = false
    /** Consecutive spawn/exit failures, driving the backoff. */
    this.failures = 0
    /** Acks waiting for their notification. */
    this.pending = new Map()
    /** Line buffer for the daemon's stdout. */
    this.stdoutBuffer = ''
    /** Last error text, or null. */
    this.lastError = null
    /** Counters for the settings page. */
    this.stats = { shown: 0, failed: 0, restarted: 0 }
    /** Diagnostics sink; the plugin passes its logger. */
    this.log = typeof options.log === 'function' ? options.log : () => {}
    /** How long an ack may take before it is treated as a transport failure. */
    this.ackTimeoutMs = typeof options.ackTimeoutMs === 'number' && options.ackTimeoutMs > 0 ? options.ackTimeoutMs : ACK_TIMEOUT_MS
    /** Set while `stop()` runs, so the exit handler does not restart. */
    this.stopping = false
    /** Timer handle for a pending restart. */
    this.restartTimer = null
  }

  /** @returns true when this platform can show toasts at all. */
  get supported() {
    return isSupported()
  }

  /**
   * Whether the daemon currently holds a live process.
   *
   * @returns true while notifications can be written immediately.
   */
  get running() {
    return this.child !== null
  }

  /**
   * Snapshot for the settings page.
   *
   * @returns a plain, JSON-serializable status object.
   */
  status() {
    return {
      supported: this.supported,
      running: this.running,
      started: this.started,
      appId: this.appId,
      appIdConfigured: this.configuredAppId !== '',
      aumidSource: this.aumidSource,
      probeNote: this.probeNote,
      lastError: this.lastError,
      ...this.stats,
    }
  }

  /**
   * Apply a changed AUMID preference.
   *
   * The AUMID is baked into each command rather than into the daemon process, so
   * a change needs no restart — only the candidate list, the current choice and
   * the settled probe are replaced, and the next notification re-derives the
   * identity it speaks for.
   *
   * @param appId - configured AUMID, or an empty string to adapt again.
   * @returns nothing.
   */
  setAppId(appId) {
    const next = typeof appId === 'string' ? appId.trim() : ''
    if (next === this.configuredAppId) return
    this.configuredAppId = next
    this.candidates = next === '' ? aumidCandidates() : [next]
    this.appId = this.candidates[0]
    this.aumidSource = next === '' ? 'guess' : 'configured'
    this.probeNote = null
    this.probePromise = null
  }

  /**
   * Choose the AUMID to speak for, once per plugin life.
   *
   * `Show()` does NOT throw for an unregistered AppUserModelID — Windows files
   * the toast in Action Center under an identity with no Start Menu entry, so it
   * renders with no application name and no icon. Inferring a fallback from a
   * thrown error therefore never works, and the registration has to be checked
   * before the first notification instead. The daemon does that check against
   * the Start Menu; this method consumes its answer.
   *
   * A user-configured AUMID is used verbatim: it is an explicit instruction, and
   * second-guessing it would make the setting meaningless.
   *
   * @returns the settled promise, so concurrent callers share one probe.
   */
  resolveAppId() {
    if (this.probePromise !== null) return this.probePromise
    if (this.configuredAppId !== '' || !this.supported) {
      this.probePromise = Promise.resolve()
      return this.probePromise
    }
    this.probePromise = (async () => {
      const ack = await this.request({ op: 'probeAumid', candidates: this.candidates })
      if (ack.ok === true && typeof ack.appId === 'string' && ack.appId !== '') {
        if (ack.appId !== this.appId) {
          this.log(`[dsh-workspace-plus/notice] 使用已注册的 AUMID ${ack.appId}`)
        }
        this.appId = ack.appId
        this.aumidSource = 'probe'
        return
      }
      // Either the enumeration is unavailable or none of the candidates has a
      // Start Menu entry. Both keep the best-attribution guess: the toast still
      // appears, and the settings page reports why the attribution is unverified.
      this.probeNote =
        ack.ok === true
          ? `没有在开始菜单中找到已注册的候选 AUMID（共扫描 ${ack.startApps ?? 0} 项），继续使用 ${this.appId}。`
          : `无法确认 AUMID 是否已注册：${String(ack.error ?? '未知原因')}`
      this.log(`[dsh-workspace-plus/notice] ${this.probeNote}`)
    })()
    return this.probePromise
  }

  /**
   * Start the daemon if it is not running.
   *
   * @returns nothing; failures surface through `lastError` and the restart timer.
   */
  start() {
    if (!this.supported || this.child !== null || this.starting || this.stopping) return
    this.starting = true
    let child
    try {
      child = spawn(
        this.powershell,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      )
    } catch (error) {
      this.starting = false
      this.lastError = `无法启动 Windows PowerShell：${String((error && error.message) || error)}`
      this.scheduleRestart()
      return
    }

    this.child = child
    this.starting = false
    this.started = true
    this.stdoutBuffer = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.onStdout(chunk))
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text !== '') this.log(`[toast-host] ${text}`)
    })
    child.stdin.on('error', (error) => {
      this.log(`[toast-host] stdin error: ${String((error && error.message) || error)}`)
    })
    child.on('error', (error) => {
      this.lastError = `toast 守护进程错误：${String((error && error.message) || error)}`
      this.log(`[toast-host] ${this.lastError}`)
    })
    child.on('exit', (code, signal) => {
      this.child = null
      for (const [, entry] of this.pending) entry.reject(new Error('toast daemon exited'))
      this.pending.clear()
      if (this.stopping) return
      this.failures += 1
      this.lastError = `toast 守护进程退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`
      this.log(`[toast-host] ${this.lastError}`)
    })

    // Deliberately detached from the host's event loop: a one-shot profile
    // command (`dsh -p "…"`) raises its `任务完成` notification and must still
    // exit, and a referenced child with piped stdio would pin it forever. The
    // cost is that an ack in flight can be dropped if the host has nothing else
    // to do — and a long-lived host, which is the only kind that shows more than
    // one notification, always has a server holding the loop.
    //
    // "Unref by default, re-reference while an ack is pending" was tried and is
    // NOT available: measured on the bundled Node 24, `ref()` after `unref()` on
    // a stdio pipe does not restore liveness, so a notification could be dropped
    // mid-flight in exactly the host that must not drop it.
    child.unref()
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.unref?.()
  }

  /**
   * Schedule a restart after the current backoff step.
   *
   * @returns nothing.
   */
  scheduleRestart() {
    if (this.restartTimer !== null || this.stopping || !this.supported) return
    const delay = RESTART_BACKOFF_MS[Math.min(this.failures, RESTART_BACKOFF_MS.length - 1)]
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopping) return
      this.stats.restarted += 1
      this.start()
    }, delay)
    this.restartTimer.unref?.()
  }

  /**
   * Write one command to the daemon, starting it when necessary.
   *
   * @param command - JSON-serializable command.
   * @returns true when the line reached the pipe.
   */
  write(command) {
    const child = this.child
    if (child === null || child.stdin.destroyed) return false
    try {
      child.stdin.write(`${JSON.stringify(command)}\n`)
      return true
    } catch (error) {
      this.lastError = `写入 toast 守护进程失败：${String((error && error.message) || error)}`
      return false
    }
  }

  /**
   * Split the daemon's stdout into lines, parse each as an ack, and settle the
   * notification waiting on it.
   *
   * @param chunk - decoded stdout text.
   * @returns nothing.
   */
  onStdout(chunk) {
    this.stdoutBuffer += chunk
    // The daemon terminates every ack with a newline, so at most one partial
    // line is ever buffered. A cap keeps a misbehaving daemon from growing this
    // without bound, at the cost of one dropped ack that would have timed out.
    if (this.stdoutBuffer.length > 1_048_576) {
      this.log('[toast-host] 应答缓冲超过 1 MiB，已丢弃')
      this.stdoutBuffer = ''
      return
    }
    for (;;) {
      const index = this.stdoutBuffer.indexOf('\n')
      if (index < 0) break
      const raw = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (raw === '') continue
      let ack
      try {
        ack = JSON.parse(raw)
      } catch {
        this.log(`[toast-host] 无法解析的应答：${raw}`)
        continue
      }
      const entry = this.pending.get(ack.id)
      if (entry === undefined) continue
      this.pending.delete(ack.id)
      clearTimeout(entry.timer)
      entry.resolve(ack)
    }
  }

  /**
   * Send one command and wait for its ack.
   *
   * A transport failure is marked `transport: true` so the caller can tell it
   * apart from the daemon answering `ok: false`. That distinction matters:
   * `show()` reacts to a rejected notification by trying the next AppUserModelID,
   * and a daemon that is simply not running must not consume that list — doing so
   * would silently downgrade every later notification to the fallback identity.
   *
   * @param command - command without an `id`.
   * @returns the ack, or a synthetic transport failure.
   */
  request(command) {
    this.start()
    if (!this.running) {
      return Promise.resolve({
        id: command.id,
        ok: false,
        transport: true,
        error: this.lastError ?? 'toast 守护进程未运行',
      })
    }
    const id = randomUUID()
    const payload = { ...command, id }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ id, ok: false, transport: true, error: 'toast 守护进程未在超时内应答' })
      }, this.ackTimeoutMs)
      timer.unref?.()
      this.pending.set(id, {
        resolve,
        reject: (error) =>
          resolve({ id, ok: false, transport: true, error: String((error && error.message) || error) }),
        timer,
      })
      if (!this.write(payload)) {
        this.pending.delete(id)
        clearTimeout(timer)
        resolve({ id, ok: false, transport: true, error: this.lastError ?? 'toast 守护进程不可写' })
      }
    })
  }

  /**
   * Show one notification.
   *
   * The registered identity is settled first, so the first notification of a
   * session is already attributed correctly rather than being corrected by a
   * second attempt. A `Show` failure still walks the remaining candidates once,
   * which covers the Windows builds that DO reject an unknown AUMID outright.
   *
   * @param notification - `{ title, session, detail, launch, tag, silent, duration }`.
   * @returns the ack describing what happened.
   */
  async show(notification) {
    if (!this.supported) {
      return { ok: false, error: '当前平台不支持 Windows 原生通知' }
    }
    await this.resolveAppId()
    const attempted = []
    for (;;) {
      const appId = this.appId
      attempted.push(appId)
      const ack = await this.request({
        op: 'show',
        appId,
        title: notification.title,
        body: [notification.session, notification.detail].filter((part) => typeof part === 'string' && part !== ''),
        launch: notification.launch,
        tag: notification.tag,
        group: TOAST_GROUP,
        silent: notification.silent === true,
        duration: notification.duration,
      })
      if (ack.ok === true) {
        this.failures = 0
        this.lastError = null
        this.stats.shown += 1
        // The AUMID travels with the ack: a notification shown under a fallback
        // identity can only be withdrawn under that same identity.
        return { ...ack, appId }
      }
      if (ack.transport === true) {
        this.stats.failed += 1
        this.lastError = `通知未能送达守护进程：${ack.error ?? '未知错误'}`
        this.log(`[dsh-workspace-plus/notice] ${this.lastError}`)
        return ack
      }
      const next = this.candidates.find((candidate) => !attempted.includes(candidate))
      if (next === undefined) {
        this.stats.failed += 1
        this.lastError = `通知发送失败：${ack.error ?? '未知错误'}`
        this.log(`[dsh-workspace-plus/notice] ${this.lastError}`)
        return ack
      }
      this.appId = next
      this.log(`[dsh-workspace-plus/notice] AUMID ${appId} 不可用，改用 ${next}`)
    }
  }

  /**
   * Ask Windows to drop a notification from Action Center.
   *
   * Used when the decision a notification announced has been made, so the user
   * does not keep seeing a request that is already resolved.
   *
   * The identity is passed in rather than read from `this.appId`: `show()` may
   * have fallen back to another candidate for that particular notification, and
   * `History.Remove` matches on tag, group AND AppUserModelID, so removing under
   * the wrong one silently does nothing. The call goes through `request()`, which
   * restarts a daemon that died between the notification and its answer.
   *
   * @param tag - the notification's tag.
   * @param appId - the identity the notification was shown under.
   * @returns the ack.
   */
  async remove(tag, appId) {
    if (!this.supported) return { ok: false, error: '当前平台不支持 Windows 原生通知' }
    return this.request({ op: 'remove', appId: appId ?? this.appId, tag, group: TOAST_GROUP })
  }

  /**
   * Stop the daemon and cancel any scheduled restart.
   *
   * @returns nothing.
   */
  stop() {
    this.stopping = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    if (child !== null) {
      try {
        child.stdin.end()
      } catch {
        // the pipe was already gone
      }
      const killer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // the process already exited
        }
      }, 1_000)
      killer.unref?.()
    }
    for (const [, entry] of this.pending) entry.reject(new Error('toast daemon stopped'))
    this.pending.clear()
  }
}
