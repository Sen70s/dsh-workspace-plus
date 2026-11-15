/**
 * dsh-workspace-plus / sessionlog — pure settings layer.
 *
 * Everything in this file is pure or filesystem-only, so tools/verify.mjs can
 * exercise it without a running Harness and without DSH's own services. The
 * two-layer shape is the same one `lib/notice/settings.js` uses:
 *
 *   1. **bundle config** — the keys a deployment writes under the loader row's
 *      `config:` in `cordis.patch.yml`. They are deployment defaults and
 *      survive upgrades.
 *   2. **override store** — `$DSH_HOME/sessionlog/settings.json` holds only the
 *      keys the user changed on the 会话日志 settings page. "Restore default"
 *      deletes the key instead of writing the default value.
 *
 * `enabled` defaults to `false`: this sub-feature ships OFF. Uploading a
 * session log hands the machine's conversation content to a remote collector,
 * so turning it on has to be an explicit act by whoever runs this host.
 *
 * @module dsh-workspace-plus/sessionlog/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Shipping collection endpoint. The same DeepSeek-operated collector the base
 * profile's own OpenTelemetry session backend uses, so a deployment that has
 * already pointed `DSH_TELEMETRY_OTLP_URL` at an isolated collector gets the
 * same destination here for free.
 */
export const DEFAULT_ENDPOINT = 'https://dsh-otel-collector.deepseeksvc.com/v1/logs'

/** Environment variable that overrides {@link DEFAULT_ENDPOINT}. */
export const ENDPOINT_ENV = 'DSH_TELEMETRY_OTLP_URL'

/**
 * Process-level telemetry opt-out. DSH's base profile patches its own
 * session-telemetry row `disabled` when this is set, and treats ANY non-empty
 * value — including `0` and `false` — as "off".
 */
export const TELEMETRY_DISABLED_ENV = 'DSH_TELEMETRY_DISABLED'

/** Selective-telemetry mode variable; `DISABLED` is the value that means "off". */
export const TELEMETRY_MODE_ENV = 'DSH_TELEMETRY_MODE'

/**
 * Whether the process has opted out of telemetry entirely.
 *
 * A deployment that exports `DSH_TELEMETRY_DISABLED` (or sets
 * `DSH_TELEMETRY_MODE=DISABLED`) has said "nothing leaves this machine", and
 * that has to outrank a setting this plugin's own page can flip. Honouring it
 * is what keeps the plugin from being a way around the host's opt-out.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the reason to stay silent, or `null` when the process has not opted out.
 */
export function telemetryKillSwitch(env = process.env) {
  const disabled = env[TELEMETRY_DISABLED_ENV]
  if (typeof disabled === 'string' && disabled !== '') {
    return `${TELEMETRY_DISABLED_ENV} 已设置，进程级关闭遥测`
  }
  const mode = typeof env[TELEMETRY_MODE_ENV] === 'string' ? env[TELEMETRY_MODE_ENV].trim().toUpperCase() : ''
  if (mode === 'DISABLED') return `${TELEMETRY_MODE_ENV}=DISABLED，进程级关闭遥测`
  return null
}

/**
 * Whether uploading may run at all: the switch is on AND the process has not
 * opted out of telemetry.
 *
 * @param settings - effective settings.
 * @param env - environment snapshot (injectable for tests).
 * @returns the reason uploading is suppressed, or `null` when it may run.
 */
export function uploadBlockedBy(settings, env = process.env) {
  if (settings?.enabled !== true) return '开关未开启'
  return telemetryKillSwitch(env)
}

/** Store format version. */
export const STORE_VERSION = 1

/**
 * Defaults for every setting. The single source of truth: `normalizeSettings`
 * derives from it, the settings page renders it, and "restore default" means
 * "drop the override so this value applies again".
 *
 * `requestField` is the second, provider-coupled half of the feature: when the
 * official DeepSeek adapter performs the request and no other plugin already
 * owns the `dsh_session_log` field (in a shipped profile the built-in
 * `@deepseek-ai/dsh-session-log-deepseek` does), this sub-feature contributes
 * the field in the shipped v1 wire format.
 *
 * It ships OFF for a reason that is not obvious from its name. DSH performs no
 * official-endpoint check before attaching that field — the only condition is
 * "the request came from the DeepSeek adapter" — and the adapter's `baseURL` is
 * freely configurable. A host whose `deepseek-official` route points at a
 * third-party relay would therefore send conversation content to that relay,
 * while this plugin's switch claims to upload to DeepSeek. Making it an
 * explicit opt-in keeps the parity fallback available without that surprise.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  endpoint: '',
  requestField: false,
  includeHistory: true,
  maxRequestBytes: 4000000,
  shutdownTimeoutMillis: 3000,
})

/** Every key the override store is allowed to carry. */
export const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS))

/** Upper bound for `maxRequestBytes`, mirroring DSH's own session-log ceiling. */
export const MAX_REQUEST_BYTES_CEILING = 4000000

/** Upper bound for `shutdownTimeoutMillis`. */
export const MAX_SHUTDOWN_TIMEOUT_MILLIS = 60000

/** @returns a fresh defaults object (never a shared reference). */
export function defaultSettings() {
  return { ...DEFAULT_SETTINGS }
}

/**
 * Coerce anything into `enabled`/`requestField`/`includeHistory` booleans.
 * YAML is the reason this exists: a hand-edited `config:` block can deliver
 * `'false'`, `'no'`, `'off'` or `0`, and treating the string `'false'` as truthy
 * would silently switch uploading ON.
 *
 * @param value - the raw value.
 * @param fallback - the value to use when nothing usable was supplied.
 * @returns a boolean.
 */
export function coerceBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(text)) return true
    if (['false', '0', 'no', 'off'].includes(text)) return false
  }
  return fallback
}

/**
 * Clamp a byte/time count into `[0, max]`.
 *
 * An absent or blank value is the fallback, not zero: `Number('')` is `0`, so a
 * naive coercion would turn every omitted key into a hard zero — a zero-length
 * upload budget silently disables the whole feature.
 *
 * @param value - the raw value.
 * @param fallback - the value to use when nothing usable was supplied.
 * @param max - inclusive upper bound.
 * @returns a non-negative integer.
 */
export function coerceCount(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.min(Math.floor(number), max)
}

/**
 * Coerce the endpoint. Only an absolute `http(s)` URL is accepted; anything
 * else falls back to `''`, which means "use the environment variable, else the
 * shipping collector". A bad endpoint must never be silently used as a request
 * target, and it must never silently disable uploading either — hence the
 * separate `warning` channel on {@link normalizeEndpoint}.
 *
 * @param value - the raw value.
 * @returns `{ value, warning }`, where `value` is `''` or a normalized URL.
 */
export function normalizeEndpoint(value) {
  if (value === null || value === undefined) return { value: '', warning: null }
  const text = String(value).trim()
  if (text === '') return { value: '', warning: null }
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return { value: '', warning: `endpoint 不是合法 URL，已回落默认值：${text}` }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { value: '', warning: `endpoint 必须是 http(s)，已回落默认值：${text}` }
  }
  return { value: parsed.toString(), warning: null }
}

/**
 * Fill in every default and drop every unusable value.
 *
 * @param input - the raw settings object, or anything else.
 * @returns a complete settings object.
 */
export function normalizeSettings(input) {
  const raw = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const endpoint = normalizeEndpoint(raw.endpoint)
  return {
    enabled: coerceBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
    endpoint: endpoint.value,
    requestField: coerceBoolean(raw.requestField, DEFAULT_SETTINGS.requestField),
    includeHistory: coerceBoolean(raw.includeHistory, DEFAULT_SETTINGS.includeHistory),
    maxRequestBytes: coerceCount(raw.maxRequestBytes, DEFAULT_SETTINGS.maxRequestBytes, MAX_REQUEST_BYTES_CEILING),
    shutdownTimeoutMillis: coerceCount(raw.shutdownTimeoutMillis, DEFAULT_SETTINGS.shutdownTimeoutMillis, MAX_SHUTDOWN_TIMEOUT_MILLIS),
  }
}

/**
 * Merge a base (bundle config) with user overrides. Overrides win key by key;
 * an absent key keeps the base value.
 *
 * @param base - the bundle-config defaults.
 * @param overrides - what the settings page persisted.
 * @returns the effective settings.
 */
export function composeSettings(base, overrides) {
  const normalizedBase = normalizeSettings(base)
  const patch = {}
  for (const key of SETTING_KEYS) {
    if (overrides !== null && typeof overrides === 'object' && Object.prototype.hasOwnProperty.call(overrides, key)) {
      patch[key] = overrides[key]
    }
  }
  return normalizeSettings({ ...normalizedBase, ...patch })
}

/**
 * Keep only the keys this version understands. A newer build's store must not
 * push values into an older build, and a hand-edited file must not smuggle
 * arbitrary keys into the effective settings.
 *
 * @param patch - the requested override keys.
 * @returns a normalized override object carrying only known keys.
 */
export function mergeOverrides(patch) {
  const raw = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const overrides = {}
  for (const key of SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) overrides[key] = raw[key]
  }
  return overrides
}

/**
 * Drop one override so the base value applies again.
 *
 * @param overrides - the current overrides.
 * @param key - the key to drop.
 * @returns a fresh overrides object.
 */
export function clearOverride(overrides, key) {
  const next = { ...(overrides !== null && typeof overrides === 'object' ? overrides : {}) }
  delete next[key]
  return next
}

/**
 * Locate the Harness home the same way the rest of the plugin and the rest of
 * the Harness do: `DSH_HOME` when set and non-blank, else `~/.dsh`.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the absolute Harness home directory.
 */
export function dshHome(env = process.env) {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

/**
 * Absolute path of this sub-feature's override store.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the settings file path.
 */
export function storePath(env = process.env) {
  return join(dshHome(env), 'sessionlog', 'settings.json')
}

/** Filename of the Harness-wide anonymous user id, shared with DSH's telemetry. */
export const ANONYMOUS_USER_ID_FILE_NAME = '.anonymous-user-id'

/** Anonymous user id files are bare UUID lines; anything else is corruption. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read a valid persisted anonymous user id.
 *
 * @param file - the id file path.
 * @returns the id, or `undefined` when absent or corrupt.
 */
function readAnonymousUserId(file) {
  try {
    const text = readFileSync(file, 'utf8').trim()
    return UUID_PATTERN.test(text) ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * The harness home's anonymous user id, created on first use.
 *
 * This deliberately mirrors `@deepseek-ai/dsh-anonymous-user-id` byte for byte
 * — same file, same bare-UUID + newline format, same `wx` first-writer-wins
 * create — because the id is a resource attribute the collector already uses to
 * group one machine's uploads. Minting a different identifier here would split
 * the same host into two identities. Persistence stays best-effort: a read-only
 * home still yields a usable per-run id so uploading is never blocked by it.
 *
 * @param env - environment snapshot (injectable for tests).
 * @param makeId - id generator (injectable for tests).
 * @returns the id, or `''` when it could not be produced at all.
 */
export function anonymousUserId(env = process.env, makeId = randomUUID) {
  const file = join(dshHome(env), ANONYMOUS_USER_ID_FILE_NAME)
  const existing = readAnonymousUserId(file)
  if (existing !== undefined) return existing
  const created = makeId()
  if (!UUID_PATTERN.test(created)) return ''
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${created}\n`, { encoding: 'utf8', flag: 'wx' })
    return created
  } catch {
    return readAnonymousUserId(file) ?? created
  }
}

/**
 * Report the effective collector endpoint: the settings override first, then
 * `DSH_TELEMETRY_OTLP_URL`, then the shipping collector.
 *
 * @param settings - effective settings (normalized or raw).
 * @param env - environment snapshot (injectable for tests).
 * @returns the endpoint URL.
 */
export function resolveEndpoint(settings, env = process.env) {
  const explicit = normalizeEndpoint(settings?.endpoint).value
  if (explicit !== '') return explicit
  const fromEnv = typeof env[ENDPOINT_ENV] === 'string' ? env[ENDPOINT_ENV].trim() : ''
  if (fromEnv !== '') return normalizeEndpoint(fromEnv).value || DEFAULT_ENDPOINT
  return DEFAULT_ENDPOINT
}

/**
 * Normalize the accepted-watermark map used by the `dsh_session_log` request
 * field: `{ <sessionId>: { formatVersion, throughSeq } }`.
 *
 * The watermark lives here rather than in a canonical session event on purpose.
 * The shipped package records acceptance as its own event type, but that event
 * type is baked into the Session format migrations, and a third-party plugin
 * must not add a new type to the canonical log. Keeping the cursor in this
 * plugin's own store gets the same "do not resend the accepted range" property
 * without touching the session format at all.
 *
 * @param raw - the parsed `accepted` value, or anything else.
 * @returns a clean watermark map.
 */
export function normalizeAccepted(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const accepted = {}
  for (const [sessionId, entry] of Object.entries(raw)) {
    if (sessionId === '' || entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const throughSeq = Number(entry.throughSeq)
    const formatVersion = Number(entry.formatVersion)
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 0) continue
    if (!Number.isSafeInteger(formatVersion) || formatVersion < 0) continue
    accepted[sessionId] = { formatVersion, throughSeq }
  }
  return accepted
}

/**
 * Read the store, tolerating a missing, unreadable, or corrupt file. A corrupt
 * store degrades to "no overrides, no watermarks" with a warning; it must never
 * stop the Harness from booting, and it must never be guessed at (a corrupt
 * file cannot turn uploading on, and a corrupt watermark only causes a resend).
 *
 * @param file - the store path.
 * @returns `{ overrides, accepted, warning }`.
 */
export function readStore(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { overrides: {}, accepted: {}, warning: null }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { overrides: {}, accepted: {}, warning: `${file} 不是对象；已按默认值处理` }
  }
  const warnings = []
  let overrides = {}
  if (parsed.overrides !== undefined) {
    if (parsed.overrides !== null && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)) {
      overrides = mergeOverrides(parsed.overrides)
    } else {
      warnings.push('overrides 不是对象')
    }
  }
  return {
    overrides,
    accepted: normalizeAccepted(parsed.accepted),
    warning: warnings.length === 0 ? null : `${file} 的 ${warnings.join('、')}；已按默认值处理`,
  }
}

/**
 * Persist the store atomically (temp file + rename) and never throw.
 *
 * @param file - the store path.
 * @param store - `{ overrides, accepted }` to persist.
 * @returns `{ ok, message }`.
 */
export function writeStore(file, store) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    const document = {
      version: STORE_VERSION,
      overrides: mergeOverrides(store?.overrides),
      accepted: normalizeAccepted(store?.accepted),
    }
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    return { ok: true, message: `saved ${file}` }
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
}
