/**
 * dsh-workspace-plus/notice — notification wording (ported from dsh-notice).
 *
 * Everything here is pure: one event in, one fully-formed notification
 * descriptor out, or `null` when the event must not be announced at all. Keeping
 * the wording out of the plugin body is what makes the interesting cases — an
 * aborted turn, an error turn, a question with no text — testable without a
 * running Harness.
 *
 * A descriptor is deliberately three short lines rather than one sentence. A
 * Windows toast renders the first line bold and wraps the rest, and the user's
 * question is always "which conversation, and what does it want", so the type
 * leads, the conversation follows, and the detail lands last.
 *
 * @module dsh-workspace-plus/notice/format
 */

/**
 * Operating-system command escape sequences, including unterminated tails.
 * Session text reaches a toast verbatim, and a tool name or model message that
 * carries terminal escapes would render as invisible junk in the notification.
 */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu

/** CSI escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu

/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu

/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu

/**
 * Directional and invisible controls. They can reorder or hide the visible text
 * of a notification, so a title or model message carrying them is not allowed to
 * make the toast say something other than what it appears to say.
 */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/** Byte budget of the bold first line. */
export const TITLE_BYTES = 120

/** Byte budget of the trailing detail line. */
export const DETAIL_BYTES = 320

/** Byte budget of the conversation line. */
export const SESSION_BYTES = 160

/**
 * Reduce untrusted text to one clean, single-line string.
 *
 * @param input - any text (non-strings become an empty string).
 * @returns the cleaned text.
 */
export function cleanText(input) {
  if (typeof input !== 'string') return ''
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Truncate a string to a UTF-8 byte budget without splitting a code point.
 *
 * Windows clips a toast line by width, which can leave half a character; cutting
 * on a code-point boundary with an ellipsis reads as deliberate.
 *
 * @param input - text to truncate.
 * @param maxBytes - positive byte budget.
 * @returns the possibly shortened text.
 */
export function truncateUtf8(input, maxBytes) {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input
  const ellipsis = '…'
  const budget = Math.max(1, maxBytes - Buffer.byteLength(ellipsis, 'utf8'))
  let used = 0
  let output = ''
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > budget) break
    output += character
    used += bytes
  }
  return `${output.trimEnd()}${ellipsis}`
}

/**
 * Clean and bound one line of notification text.
 *
 * @param input - raw text.
 * @param maxBytes - byte budget.
 * @returns the finished line.
 */
export function line(input, maxBytes) {
  return truncateUtf8(cleanText(input), maxBytes)
}

/**
 * Last path segment of a directory, used when a conversation has no title yet.
 *
 * @param path - absolute directory path.
 * @returns the trailing segment, or an empty string.
 */
export function basenameOf(path) {
  const text = typeof path === 'string' ? path.replace(/[\\/]+$/u, '') : ''
  if (text === '') return ''
  const parts = text.split(/[\\/]/u)
  return parts[parts.length - 1] ?? ''
}

/**
 * The conversation line of a notification.
 *
 * A session's own title is the best label, but a brand-new conversation has none
 * until its first prompt is folded into one, and a notification about it must
 * still say something useful — hence the directory fallback before the raw id.
 *
 * @param info - `{ title, cwd, id }`.
 * @returns the conversation line.
 */
export function sessionLabel(info) {
  const titled = cleanText(info?.title)
  if (titled !== '') return truncateUtf8(titled, SESSION_BYTES)
  const directory = basenameOf(info?.cwd)
  if (directory !== '') return truncateUtf8(directory, SESSION_BYTES)
  const id = cleanText(info?.id)
  return id === '' ? '会话' : truncateUtf8(id, SESSION_BYTES)
}

/**
 * Wording for one cancellation cause carried by an aborted turn.
 *
 * @param cause - `TurnEndCancelCause`.
 * @returns a short Chinese phrase, or an empty string when nothing is known.
 */
export function describeCancelCause(cause) {
  if (cause === null || typeof cause !== 'object') return ''
  switch (cause.kind) {
    case 'user':
      return '你取消了这次任务'
    case 'parent':
      return '父会话取消了这次任务'
    case 'hook':
      return `扩展取消了这次任务：${cleanText(cause.reason)}`
    case 'disposed':
      return '会话已关闭'
    case 'legacy':
      return '任务被取消'
    default:
      return ''
  }
}

/**
 * Build the notification descriptor for a pending approval request.
 *
 * This is raised BEFORE the composed answerers run, so the user learns that a
 * decision is waiting even when the Harness window is behind another one.
 *
 * @param input - `{ info, toolName, reason, displayReason }`.
 * @returns the descriptor.
 */
export function describeApproval(input) {
  const toolName = cleanText(input?.toolName)
  const display = input?.displayReason
  const localized =
    display !== null && typeof display === 'object'
      ? cleanText(display.zh ?? display['zh-CN'] ?? display.en)
      : ''
  const reason = cleanText(input?.reason)
  const detail = [toolName === '' ? '' : `工具 ${toolName}`, localized || reason].filter((part) => part !== '').join(' · ')
  return {
    kind: 'approval',
    title: '需要你确认权限',
    session: sessionLabel(input?.info),
    detail: line(detail, DETAIL_BYTES),
  }
}

/**
 * Build the notification descriptor for a structured question.
 *
 * @param input - `{ info, questions }`.
 * @returns the descriptor.
 */
export function describeQuestion(input) {
  const questions = Array.isArray(input?.questions) ? input.questions : []
  const first = questions[0]
  const asked = cleanText(first?.question)
  const header = cleanText(first?.header)
  const primary = asked === '' ? header : asked
  const detail = questions.length > 1 ? `${primary}（共 ${questions.length} 个问题）` : primary
  return {
    kind: 'question',
    title: '需要你回答',
    session: sessionLabel(input?.info),
    detail: line(detail, DETAIL_BYTES),
  }
}

/**
 * Wording of one `turn/end` reason.
 *
 * `null` means "do not announce this": a fork is a copy, not a finished piece of
 * work, and announcing it would claim the user's attention for nothing.
 */
const TURN_END_WORDING = {
  completed: { kind: 'done', title: '任务完成' },
  'max-tokens': { kind: 'done', title: '任务结束（达到长度上限）' },
  aborted: { kind: 'aborted', title: '任务已中断' },
  interrupted: { kind: 'aborted', title: '任务已中断' },
  blocked: { kind: 'aborted', title: '任务被阻塞' },
  error: { kind: 'error', title: '任务出错' },
  forked: null,
}

/**
 * Build the notification descriptor for a finished turn.
 *
 * @param input - `{ info, reason, durationMs }`.
 * @returns the descriptor, or `null` when this reason is not announced.
 */
export function describeTurnEnd(input) {
  const reason = input?.reason
  const kindName = reason !== null && typeof reason === 'object' ? reason.kind : undefined
  const wording = Object.prototype.hasOwnProperty.call(TURN_END_WORDING, kindName) ? TURN_END_WORDING[kindName] : null
  if (wording === null || wording === undefined) return null

  let detail = ''
  if (kindName === 'aborted') detail = describeCancelCause(reason.reason)
  else if (kindName === 'error') detail = cleanText(reason.error?.message)
  else if (kindName === 'max-tokens') detail = '模型回复达到输出上限，任务在此停下'
  else if (kindName === 'blocked') detail = '任务需要新的输入才能继续'

  const seconds = Number.isFinite(input?.durationMs) && input.durationMs >= 0 ? Math.round(input.durationMs / 1000) : null
  if (seconds !== null && seconds >= 1 && kindName === 'completed') {
    detail = detail === '' ? `用时 ${seconds} 秒` : `${detail} · 用时 ${seconds} 秒`
  }

  return {
    kind: wording.kind,
    title: wording.title,
    session: sessionLabel(input?.info),
    detail: line(detail, DETAIL_BYTES),
  }
}

/**
 * Build the notification descriptor for a turn that failed outside a durable
 * turn position (`agent/error`).
 *
 * @param input - `{ info, error }`.
 * @returns the descriptor.
 */
export function describeAgentError(input) {
  const error = input?.error
  const message =
    error !== null && typeof error === 'object' && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return {
    kind: 'error',
    title: '任务出错',
    session: sessionLabel(input?.info),
    detail: line(message, DETAIL_BYTES),
  }
}

/**
 * Whether one session should be announced under a scope.
 *
 * A subagent or a teammate is work the user did not start by hand, and a busy
 * Lead can spawn dozens of them; announcing each turn would bury the
 * conversation the user is actually following. `roots` therefore keeps the
 * notifications to sessions the user opened himself.
 *
 * @param header - `SessionHeader`-shaped object.
 * @param scope - `'roots'` or `'all'`.
 * @returns true when this session is in scope.
 */
export function isInScope(header, scope) {
  if (scope === 'all') return true
  if (header === null || typeof header !== 'object') return true
  if (header.origin === 'subagent') return false
  if (header.parentSession !== undefined && header.parentSession !== null) return false
  return true
}

/**
 * The activation argument a toast carries.
 *
 * The host owns the meaning of this URL; it is included in the descriptor so the
 * pure formatting layer stays independent of the transport.
 *
 * @param scheme - registered protocol scheme.
 * @param sessionId - conversation to open.
 * @param kind - notification class.
 * @returns the protocol URL.
 */
export function openUrl(scheme, sessionId, kind) {
  const query = new URLSearchParams()
  query.set('s', String(sessionId ?? ''))
  query.set('k', String(kind ?? ''))
  return `${scheme}:open?${query.toString()}`
}
