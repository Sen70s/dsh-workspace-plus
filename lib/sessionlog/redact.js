/**
 * dsh-workspace-plus / sessionlog — outbound credential redaction.
 *
 * A session log is not just a conversation: it embeds every tool call the model
 * made and every result that came back. In practice that means `npm config set
 * …:_authToken=…`, `git` remotes with embedded credentials, `Authorization`
 * headers echoed by curl, private key bodies read by an editor, and so on. Those
 * values are ordinary strings in `event.data`, and nothing upstream removes them:
 * DSH's own session-telemetry seam ships NO redaction rules by default, so an
 * unmodified record leaves the machine exactly as captured.
 *
 * This module is applied to every event on its way out, before either upload
 * channel sees it, and it cannot be switched off: a session log upload without
 * redaction is a credential leak with a progress bar. Redaction never touches
 * the canonical log — it operates on copies, so what the user can still read in
 * their own session is unaffected.
 *
 * The patterns are deliberately shape-based (prefixes and key names that only
 * exist for credentials) rather than entropy-based, so ordinary prose and code
 * survive intact and the result is predictable.
 *
 * @module dsh-workspace-plus/sessionlog/redact
 */

/** What a scrubbed value is replaced with. Stable so receivers can count redactions. */
export const REDACTED = '[REDACTED]'

/**
 * Credential shapes, ordered most-specific first. Each `replace` keeps whatever
 * context is useful (`_authToken=` stays, only the value goes) so a redacted log
 * is still readable as a record of what happened.
 */
export const CREDENTIAL_PATTERNS = Object.freeze([
  // npm: the modern granular/automation token and the legacy `_authToken` line.
  { name: 'npm-token', re: /npm_[A-Za-z0-9]{36,}/g, replace: `npm_${REDACTED}` },
  {
    name: 'npm-authtoken',
    // The value may be bare, quoted, or JSON-escaped inside a nested string
    // (a tool result that itself contains JSON is common), so the alternatives
    // admit optional backslash-escaped quotes.
    re: /(_authToken\s*[=:]\s*)(?:\\?"(?:[^"\\]|\\.)*\\?"|\\?'(?:[^'\\]|\\.)*\\?'|[^\s"'\\]+)/g,
    replace: `$1${REDACTED}`,
  },
  // GitHub
  { name: 'github-pat', re: /github_pat_[A-Za-z0-9_]{20,}/g, replace: `github_pat_${REDACTED}` },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, replace: `gh*_${REDACTED}` },
  // Model providers
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g, replace: `sk-ant-${REDACTED}` },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{32,}/g, replace: `sk-${REDACTED}` },
  // Bearer / basic auth in headers and command lines
  { name: 'bearer', re: /([Bb]earer\s+)[A-Za-z0-9._~+/-]{20,}=*/g, replace: `$1${REDACTED}` },
  { name: 'url-credentials', re: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/"'@:]+:[^\s/"'@]+@/gi, replace: `$1${REDACTED}@` },
  // Other common ones that turn up in real logs
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: `AKIA${REDACTED}` },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replace: `xox*-${REDACTED}` },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: `AIza${REDACTED}` },
  // Private key bodies: everything between the markers goes.
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`,
  },
])

/**
 * Scrub every credential shape out of one string.
 *
 * @param text - any string that may leave the machine.
 * @returns the same text with credential shapes replaced.
 */
export function redactText(text) {
  if (typeof text !== 'string' || text === '') return text
  let out = text
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern.re, pattern.replace)
  }
  return out
}

/**
 * An object key that means "the value is a credential". Deliberately anchored so
 * ordinary measurements survive: `max_tokens`, `maxTokens` and `tokenCount` are
 * data worth keeping, while `GITHUB_TOKEN`, `client_secret` and `apiKey` are not.
 */
export const SECRET_KEY_PATTERN =
  /^(?:.*[_-])?(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|authorization|auth)$/i

/**
 * Scrub every string reachable from one JSON-ish value, on a copy.
 *
 * A depth bound keeps a pathological payload (a deeply nested tool result) from
 * turning redaction into a stack overflow; past the bound the subtree is
 * replaced by a single marker, which is the fail-closed direction.
 *
 * @param value - the value to copy and scrub.
 * @param depth - remaining recursion allowance.
 * @returns a scrubbed copy; the input is never mutated.
 */
export function redactValue(value, depth = 32) {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (depth <= 0) return REDACTED
  if (Array.isArray(value)) return value.map((child) => redactValue(child, depth - 1))
  if (value instanceof Uint8Array) return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    // A secret-named key keeps its name — the log still says what was there — and loses its value.
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(child, depth - 1)
  }
  return out
}

/**
 * Copy one canonical event with its payload scrubbed. The envelope (`seq`,
 * `time`, `type`, surface metadata) is structural and passes through unchanged.
 *
 * @param event - a canonical session event.
 * @returns a redacted copy.
 */
export function redactEvent(event) {
  if (event === null || typeof event !== 'object') return event
  const copy = { ...event }
  if (event.data !== undefined) copy.data = redactValue(event.data)
  return copy
}

/**
 * Whether any pattern is at least present in a record, for the diagnostics the
 * settings page shows. Reports which pattern families matched, never the values.
 *
 * @param value - the value that was (or will be) sent.
 * @returns the sorted names of the credential shapes found.
 */
export function detectCredentialShapes(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  const found = new Set()
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.re.lastIndex = 0
    if (pattern.re.test(text)) found.add(pattern.name)
  }
  return [...found]
}
