/**
 * dsh-workspace-plus/notice — settings (ported from dsh-notice).
 *
 * Two layers decide how the plugin behaves, and they are deliberately kept
 * apart:
 *
 *   - the **bundle config**, written by the user in `cordis.patch.yml` under the
 *     plugin row's `config:` key. It is a deployment default: it survives
 *     upgrades, and it is where a whole profile turns a notification class off.
 *   - the **override store**, this plugin's own JSON file under
 *     `$DSH_HOME/notice/settings.json`. It holds only the keys the user changed
 *     from the Harness Settings page, so "restore default" is a key deletion
 *     rather than a guess at what the default was.
 *
 * Effective settings are `normalize(config)` with the overrides merged on top.
 * Every value is coerced and clamped here, because the config object arrives
 * from YAML where `"false"` and `false` are easy to confuse, and a wrong type
 * must never reach the toast path.
 *
 * @module dsh-workspace-plus/notice/settings
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** On-disk store format version. */
export const STORE_VERSION = 1

/** Notification classes the plugin can raise, in Settings-page order. */
export const KINDS = ['approval', 'question', 'done', 'aborted', 'error']

/** Human labels for each class, used by the settings route and the docs. */
export const KIND_LABELS = {
  approval: '请求权限',
  question: '询问用户',
  done: '任务完成',
  aborted: '任务中断',
  error: '任务出错',
}

/** Which sessions produce notifications by default. */
export const SCOPES = ['roots', 'all']

/** Toast display durations Windows accepts. */
export const DURATIONS = ['short', 'long']

/**
 * Protocol scheme grammar. A scheme with a stray colon or space would be written
 * into the registry as an unusable key, so it is validated before any write.
 */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{1,31}$/

/**
 * Schemes this plugin must never claim.
 *
 * The scheme becomes `HKCU\Software\Classes\<scheme>\shell\open\command`, so
 * registering one of these would hijack every link of that kind for the current
 * user: `scheme: "http"` would route every web link on the machine into the
 * plugin's launcher. The set covers the browser, the shell, the office and
 * settings handlers, and the script protocols; prefixes cover the `ms-*` family
 * and vendor-specific handlers.
 */
export const RESERVED_SCHEMES = new Set([
  'about',
  'blob',
  'callto',
  'data',
  'dsh',
  'file',
  'ftp',
  'http',
  'https',
  'javascript',
  'mailto',
  'microsoft-edge',
  'search-ms',
  'shell',
  'sms',
  'tel',
  'vbscript',
  'view-source',
  'ws',
  'wss',
])

/** Prefixes whose schemes belong to the operating system or another application. */
const RESERVED_PREFIXES = ['ms-', 'microsoft-', 'chrome', 'moz-', 'edge', 'vscode', 'vscode-insiders']

/**
 * Whether a scheme may be registered by this plugin.
 *
 * @param scheme - normalized lowercase scheme.
 * @returns true when the plugin may own it.
 */
export function isClaimableScheme(scheme) {
  if (!SCHEME_PATTERN.test(scheme)) return false
  if (RESERVED_SCHEMES.has(scheme)) return false
  return !RESERVED_PREFIXES.some((prefix) => scheme.startsWith(prefix))
}

/** Default settings. This object is the only source of truth for defaults. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  kinds: Object.freeze({ approval: true, question: true, done: true, aborted: true, error: true }),
  scope: 'roots',
  sound: true,
  duration: 'short',
  appId: '',
  scheme: 'dsh-notice',
  registerProtocol: true,
  focusOnClick: true,
  minTurnMs: 0,
})

/**
 * Locate the Harness home the same way the rest of the Harness does.
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
 * Absolute path of the override store.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the store file path.
 */
export function storePath(env = process.env) {
  return join(dshHome(env), 'notice', 'settings.json')
}

/** @returns a fresh default settings object (never a shared reference). */
export function defaultSettings() {
  return { ...DEFAULT_SETTINGS, kinds: { ...DEFAULT_SETTINGS.kinds } }
}

/**
 * Coerce one value to a boolean.
 *
 * YAML users write `true`, but a settings page or an older store may carry
 * `"true"`, `1` or `"on"`; anything else keeps the fallback rather than
 * silently flipping a switch.
 *
 * @param value - raw value.
 * @param fallback - value used when nothing sensible is present.
 * @returns the boolean.
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
 * Coerce one value to a non-negative integer.
 *
 * @param value - raw value.
 * @param fallback - value used when nothing sensible is present.
 * @param max - inclusive upper bound.
 * @returns the integer.
 */
export function coerceCount(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(number) || number < 0) return fallback
  return Math.min(Math.floor(number), max)
}

/**
 * Coerce one value to a member of a closed set.
 *
 * @param value - raw value.
 * @param allowed - accepted members.
 * @param fallback - value used when the raw value is not a member.
 * @returns the member.
 */
export function coerceChoice(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

/**
 * Normalize a whole settings object, filling every default and discarding
 * anything malformed.
 *
 * @param input - raw settings (bundle config, store overrides, or both merged).
 * @returns a complete, valid settings object.
 */
export function normalizeSettings(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const rawKinds = raw.kinds !== null && typeof raw.kinds === 'object' ? raw.kinds : {}
  const kinds = {}
  for (const kind of KINDS) kinds[kind] = coerceBoolean(rawKinds[kind], DEFAULT_SETTINGS.kinds[kind])

  const appId = typeof raw.appId === 'string' ? raw.appId.trim() : ''
  const scheme = typeof raw.scheme === 'string' ? raw.scheme.trim().toLowerCase() : ''
  return {
    enabled: coerceBoolean(raw.enabled, DEFAULT_SETTINGS.enabled),
    kinds,
    scope: coerceChoice(raw.scope, SCOPES, DEFAULT_SETTINGS.scope),
    sound: coerceBoolean(raw.sound, DEFAULT_SETTINGS.sound),
    duration: coerceChoice(raw.duration, DURATIONS, DEFAULT_SETTINGS.duration),
    appId,
    scheme: isClaimableScheme(scheme) ? scheme : DEFAULT_SETTINGS.scheme,
    registerProtocol: coerceBoolean(raw.registerProtocol, DEFAULT_SETTINGS.registerProtocol),
    focusOnClick: coerceBoolean(raw.focusOnClick, DEFAULT_SETTINGS.focusOnClick),
    minTurnMs: coerceCount(raw.minTurnMs, DEFAULT_SETTINGS.minTurnMs, 600_000),
  }
}

/**
 * Merge one patch onto an override object, one level deep.
 *
 * `kinds` merges key by key (the settings page flips a single class at a time);
 * every other key replaces. Unknown keys are dropped, so a store written by a
 * newer plugin version cannot smuggle values into an older one.
 *
 * @param overrides - current overrides.
 * @param patch - requested changes.
 * @returns a new overrides object.
 */
export function mergeOverrides(overrides, patch) {
  const current = overrides !== null && typeof overrides === 'object' ? overrides : {}
  const next = {}
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'kinds') continue
    if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key]
    if (patch !== null && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key]
    }
  }
  const currentKinds = current.kinds !== null && typeof current.kinds === 'object' ? current.kinds : {}
  const patchKinds = patch !== null && typeof patch === 'object' && patch.kinds !== null && typeof patch.kinds === 'object' ? patch.kinds : {}
  const kinds = {}
  for (const kind of KINDS) {
    if (Object.prototype.hasOwnProperty.call(currentKinds, kind)) kinds[kind] = currentKinds[kind]
    if (Object.prototype.hasOwnProperty.call(patchKinds, kind)) kinds[kind] = patchKinds[kind]
  }
  if (Object.keys(kinds).length > 0) next.kinds = kinds
  return next
}

/**
 * Drop one key from an override object.
 *
 * @param overrides - current overrides.
 * @param key - settings key, or `kinds.<name>` for a single class.
 * @returns a new overrides object.
 */
export function clearOverride(overrides, key) {
  const current = overrides !== null && typeof overrides === 'object' ? overrides : {}
  const next = { ...current }
  if (typeof key !== 'string') return next
  if (key.startsWith('kinds.')) {
    const kind = key.slice('kinds.'.length)
    if (current.kinds !== null && typeof current.kinds === 'object') {
      const kinds = { ...current.kinds }
      delete kinds[kind]
      if (Object.keys(kinds).length === 0) delete next.kinds
      else next.kinds = kinds
    }
    return next
  }
  delete next[key]
  return next
}

/** @returns an empty store. */
export function emptyStore() {
  return { version: STORE_VERSION, overrides: {} }
}

/**
 * Read the override store, tolerating a missing or damaged file.
 *
 * A corrupt store must never keep the plugin from loading: notifications are the
 * feature, and losing a preference is a far smaller failure than losing the
 * feature. The caller is told about the damage through the returned `warning`.
 *
 * @param file - store path.
 * @returns the store plus an optional warning.
 */
export function readStore(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { store: emptyStore(), warning: null }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { store: emptyStore(), warning: `${file} is not valid JSON; settings were reset to defaults` }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { store: emptyStore(), warning: `${file} does not hold an object; settings were reset to defaults` }
  }
  return {
    store: {
      version: STORE_VERSION,
      overrides: parsed.overrides !== null && typeof parsed.overrides === 'object' ? parsed.overrides : {},
    },
    warning: null,
  }
}

/**
 * Write the override store atomically (temp file plus rename), so a crash mid
 * write cannot leave a half-written file for the next boot to parse.
 *
 * @param file - store path.
 * @param store - store to persist.
 * @returns the outcome, never a throw.
 */
export function writeStore(file, store) {
  const body = `${JSON.stringify(store, null, 2)}\n`
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    writeFileSync(temporary, body, 'utf8')
    renameSync(temporary, file)
    return { ok: true, message: `saved ${file}` }
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error) }
  }
}
