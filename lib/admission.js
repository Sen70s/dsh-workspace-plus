/**
 * The one place a plugin route asks the Host whether a request is allowed.
 *
 * `connection.admit(req)` is the only authority a plugin route has: the Host
 * fence plus the GUI session cookie. Both host halves — the workspace+ row
 * (`/workspaceplus/api`) and the 通知 row (`/dsh-notice/api`) — call this, and
 * it fails closed when that authority is absent instead of falling through to
 * "admitted":
 *
 * - no `connection` service mounted, or a service without `admit` — the host
 *   composition has no auth layer (or its API drifted): refuse with 503;
 * - `admit` throwing, rejecting, or failing to answer: the decision is
 *   unavailable, so refuse with 503;
 * - a rejection from `admit`: pass its 401 through, everything else is 403.
 *
 * The result is awaited, so a synchronous or an asynchronous `admit` is honored
 * the same way — but only an answer that actually carries no rejection counts
 * as an admission.
 *
 * There is deliberately no loopback exemption. `127.0.0.1` is not a trust
 * boundary: this machine's own processes are not authenticated callers, and a
 * page in the operator's browser reaches the loopback interface too. A route
 * that answered them without credentials could plant text in the model context
 * (workspace+ directory notes) or read and rewrite plugin state (通知 settings,
 * the registered click launcher), so every browser-facing caller presents the
 * same Host credentials as the page itself. Routes a non-browser caller must
 * reach — the 通知 protocol click target — carry their own per-process token
 * instead, and say so where they are registered.
 *
 * @param connection - the resolved `connection` service, or undefined.
 * @param req - incoming request.
 * @returns a promise of `{ ok: true }` or `{ ok: false, status, message }`.
 */
export async function checkAdmission(connection, req) {
  const unavailable = (message) => ({ ok: false, status: 503, message })
  if (connection === undefined || connection === null) {
    return unavailable('host authentication service is not mounted; refusing to answer')
  }
  if (typeof connection.admit !== 'function') {
    return unavailable('host authentication service has no admit(); refusing to answer')
  }
  let admission
  try {
    admission = await connection.admit(req)
  } catch (error) {
    return unavailable(`host authentication service failed: ${String(error?.message ?? error)}`)
  }
  const rejection = admission !== null && typeof admission === 'object' ? admission.rejection : undefined
  if (rejection !== undefined) {
    const status = rejection === 401 ? 401 : 403
    return { ok: false, status, message: status === 401 ? 'unauthorized' : 'forbidden' }
  }
  return { ok: true }
}
