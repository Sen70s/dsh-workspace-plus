/**
 * dsh-workspace-plus / sessionlog — pure wire layer.
 *
 * Two serializations live here, both pure functions over a Session object, so
 * tools/verify.mjs can pin them against plain fixtures:
 *
 *   1. **OTLP records** — one record per canonical session event, in the exact
 *      shape `ctx.otel.createSessionLogReporter(options).reportSessionLog(...)`
 *      consumes. This is the provider-independent channel: it does not care
 *      which model adapter is in play, which is the whole point of the
 *      sub-feature.
 *   2. **`dsh_session_log` v1 request field** — byte-for-byte the format the
 *      shipped `@deepseek-ai/dsh-session-log-deepseek` contributes, so a host
 *      that does not mount that package still gets the same wire contract.
 *
 * Nothing here imports anything but the sibling redactor: OTel severity numbers
 * are fixed integers and the numeric Session brands are type-level only, so
 * plain numbers are accepted by `snapshotEvents`/`seq` at runtime.
 *
 * Both serializations route `event.data` through {@link redactEvent} first, so
 * neither channel can leak a credential that a tool result happened to carry.
 *
 * @module dsh-workspace-plus/sessionlog/wire
 */

import { redactEvent } from './redact.js'

/**
 * OTel severity numbers (`@opentelemetry/api-logs` SeverityNumber). Inlined
 * because an externally installed bundle cannot resolve `@deepseek-ai/*` or
 * `@opentelemetry/*` from its own location, and these values are part of the
 * OTLP wire contract rather than of any implementation.
 */
export const SEVERITY_NUMBER = Object.freeze({ info: 9, warn: 13, error: 17 })

/** Session-log request field name, identical to the shipped package's. */
export const REQUEST_FIELD = 'dsh_session_log'

/** Request-field envelope version, identical to the shipped package's. */
export const REQUEST_FIELD_VERSION = 1

/** OTLP scope name reported for this sub-feature's records. */
export const SCOPE_NAME = 'dsh-workspace-plus/sessionlog'

/** OTLP event name, matching the shipped session-telemetry backend. */
export const EVENT_NAME = 'session-log'

/** Opaque body marker, matching the shipped session-telemetry backend. */
export const EVENT_BODY = 'session-log'

/**
 * Map one event's own outcome flag to a pre-baked severity, exactly as
 * `@deepseek-ai/dsh-session-telemetry` does, so alerting built on the shipped
 * channel keeps working when records arrive through this one.
 *
 * @param event - a canonical session event.
 * @returns `'error'` or `'info'`.
 */
export function severityOf(event) {
  switch (event?.type) {
    case 'tool/result':
      return event.data?.message?.isError === true ? 'error' : 'info'
    case 'turn/end':
      return event.data?.reason?.kind === 'error' ? 'error' : 'info'
    default:
      return 'info'
  }
}

/**
 * The minimal identity attributes the shipped backend attaches: the event
 * envelope plus self-contained header facts.
 *
 * @param session - the owning Session.
 * @param event - the event being reported.
 * @returns a flat attribute object.
 */
export function identityOf(session, event) {
  const attributes = {
    'session.id': String(session.id),
    'session.format_version': session.header?.version,
    'event.type': event.type,
    'event.seq': Number(event.seq),
  }
  const header = session.header ?? {}
  if (header.cwd !== undefined) attributes['session.cwd'] = header.cwd
  if (header.parentSession !== undefined) attributes['session.parent_id'] = String(header.parentSession)
  if (header.isSeeded === true) attributes['session.seed_length'] = Number(session.inheritedEventCount ?? 0)
  return attributes
}

/**
 * Build the record one canonical event is reported as. The event is redacted and
 * copied, so the reporter's serializer never sees a live reference into the log
 * and never sees a credential the tool output happened to carry.
 *
 * @param session - the owning Session.
 * @param event - the canonical event.
 * @returns the `reportSessionLog` payload.
 */
export function sessionLogRecord(session, event) {
  const safe = redactEvent(event)
  const { data, ...envelope } = safe
  return {
    sessionId: String(session.id),
    event: { ...envelope, data },
    severityNumber: SEVERITY_NUMBER[severityOf(event)],
    attributes: identityOf(session, event),
  }
}

/** Translate logical Session metadata to the request field's raw header. */
export function wireHeader(session) {
  const header = session.header ?? {}
  return {
    version: header.version,
    id: String(header.id),
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSession: String(header.parentSession) }),
    ...(header.isSeeded === true ? { seedLength: Number(session.inheritedEventCount ?? 0) } : {}),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
  }
}

/**
 * Translate one logical surface operation to its raw request form.
 *
 * Canonical surface events always carry an operation, so this mirrors the
 * shipped translation exactly. The `undefined` guard only exists so a
 * third-party plugin cannot turn an unexpected event into a thrown request
 * preparation — the field is omitted in that case rather than guessed at.
 *
 * @param op - the event's `surfaceOp`.
 * @returns the raw form, or `undefined` when the event carried none.
 */
export function wireSurfaceOp(op) {
  if (op === undefined || op === null) return undefined
  return op === 'append' ? op : { op: 'replace', startSeq: Number(op.startSeq), endSeq: Number(op.endSeq) }
}

/** Translate one canonical event to its raw request form. */
export function wireEvent(event) {
  const safe = redactEvent(event)
  const common = {
    seq: Number(safe.seq),
    time: safe.time,
    data: safe.data,
    ...(safe.ignorable === undefined ? {} : { ignorable: safe.ignorable }),
  }
  switch (safe.type) {
    case 'developer/message':
    case 'system/message':
    case 'user/message':
    case 'tool/result': {
      const surfaceOp = wireSurfaceOp(safe.surfaceOp)
      return {
        ...common,
        type: safe.type,
        ...(surfaceOp === undefined ? {} : { surfaceOp }),
        ...(safe.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: safe.sourceEventSeqs.map(Number) }),
      }
    }
    case 'assistant/message': {
      const surfaceOp = wireSurfaceOp(safe.surfaceOp)
      return { ...common, type: safe.type, ...(surfaceOp === undefined ? {} : { surfaceOp }) }
    }
    default:
      if (safe.ignorable === true) {
        return {
          ...common,
          type: safe.type,
          ignorable: true,
          ...(safe.surfaceOp === undefined ? {} : { surfaceOp: safe.surfaceOp }),
          ...(safe.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: safe.sourceEventSeqs }),
        }
      }
      return { ...common, type: safe.type }
  }
}

/**
 * UTF-8 length of one value's JSON text as the request body encodes it.
 *
 * @param value - any JSON-ish value.
 * @returns the byte count, or `Infinity` when it cannot be serialized at all
 *   (which counts as exceeding every limit).
 */
export function jsonBytes(value) {
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    return Number.POSITIVE_INFINITY
  }
  return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : Number.POSITIVE_INFINITY
}

/**
 * Build the `dsh_session_log` value for one request: the longest contiguous run
 * of events after `afterSeq` whose complete serialized field fits `maxBytes`.
 *
 * The accounting is deliberately the shipped package's: the envelope is
 * measured with an empty `events` array and one digit of `throughSeq`, then
 * each event is measured as its JSON text plus one separator byte, and the
 * `throughSeq` digits are re-added. Anything that does not fit is left for the
 * next request.
 *
 * @param options - the session, the exclusive lower bound, and the byte ceiling.
 * @returns `{ value, throughSeq }`, or `undefined` when nothing fits.
 */
export function buildRequestField({ session, afterSeq, maxBytes }) {
  const pending = typeof session.snapshotEvents === 'function' ? session.snapshotEvents(afterSeq + 1) : []
  const envelope = {
    version: REQUEST_FIELD_VERSION,
    sessionFormatVersion: session.header?.version,
    session: wireHeader(session),
    afterSeq: Number(afterSeq),
  }
  let bytes = jsonBytes({ ...envelope, throughSeq: 0, events: [] }) - 1
  const events = []
  for (const event of pending) {
    const wire = wireEvent(event)
    const next = bytes + (events.length === 0 ? 0 : 1) + jsonBytes(wire)
    const candidateBytes = next + String(event.seq).length
    if (candidateBytes > maxBytes) break
    bytes = next
    events.push(wire)
  }
  if (events.length === 0) return undefined
  const throughSeq = Number(pending[events.length - 1].seq)
  return { value: { ...envelope, throughSeq, events }, throughSeq }
}
