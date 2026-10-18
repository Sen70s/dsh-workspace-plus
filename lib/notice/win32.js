/**
 * dsh-workspace-plus/notice — Windows integration (ported from dsh-notice).
 *
 * Three operating-system services the host half needs, kept apart from the
 * plugin's own logic so the plugin stays loadable (and its pure helpers
 * testable) on any platform:
 *
 *   1. the AppUserModelID a toast must speak for. Windows only renders a toast
 *      raised by an unpackaged process when the AUMID belongs to a Start Menu
 *      entry, so the plugin prefers the DeepSeek Harness desktop app's own
 *      AUMID — that is what makes the toast read "DeepSeek Harness" and carry
 *      its icon — and falls back to the Windows PowerShell entry, which exists
 *      on every Windows install;
 *   2. the `dsh-notice:` URL protocol, registered under HKCU (no administrator
 *      rights), which is what turns a click on a toast into a request against
 *      this plugin's own loopback route;
 *   3. focusing the desktop window, so a click that arrives while the window is
 *      minimized still lands somewhere the user can see.
 *
 * @module dsh-workspace-plus/notice/win32
 */

import { execFile } from 'node:child_process'
import { win32 as pathWin32 } from 'node:path'

/**
 * Default AppUserModelID: the DeepSeek Harness desktop application.
 *
 * Electron calls `app.setAppUserModelId('com.deepseek.dsh')` and the installed
 * shortcut publishes the same id, so a toast raised for it is attributed to the
 * running product rather than to this plugin's helper process.
 */
export const DESKTOP_AUMID = 'com.deepseek.dsh'

/**
 * Fallback AppUserModelID: the "Windows PowerShell" Start Menu entry.
 *
 * The Windows PowerShell folder under the Start Menu gets this deterministic
 * generated id, and it is present on every Windows 10/11 install, so a machine
 * that runs the Harness without the desktop app can still raise toasts.
 */
export const POWERSHELL_AUMID =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/** AUMIDs to try, best attribution first. */
export function aumidCandidates() {
  return [DESKTOP_AUMID, POWERSHELL_AUMID]
}

/**
 * Absolute path of Windows PowerShell 5.1.
 *
 * The WinRT projection the toast API needs lives in .NET Framework, which only
 * Windows PowerShell (`powershell.exe`) exposes out of the box; PowerShell 7
 * (`pwsh`) does not ship the Windows SDK projections and would fail.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the absolute interpreter path.
 */
export function powershellPath(env = process.env) {
  const root = typeof env.SystemRoot === 'string' && env.SystemRoot !== '' ? env.SystemRoot : 'C:\\Windows'
  return pathWin32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * Whether this process can show Windows toasts at all.
 *
 * @param platform - `process.platform` (injectable for tests).
 * @returns true on Windows.
 */
export function isSupported(platform = process.platform) {
  return platform === 'win32'
}

/** Registry path of one protocol's root key. */
export function protocolKey(scheme) {
  return `HKCU\\Software\\Classes\\${scheme}`
}

/**
 * The launch command Windows runs for one `dsh-notice:` activation.
 *
 * Quoting is explicit and complete because the value is executed by
 * `ShellExecute`: the interpreter, the script and every argument are quoted, and
 * `%1` is the placeholder Windows replaces with the activated URL. The URL is
 * quoted too, because a toast arguments string may contain `&`.
 *
 * @param options - interpreter, script, port, token and scheme.
 * @returns the command line stored in the registry.
 */
export function protocolCommand(options) {
  const { powershell, script, port, token, scheme, protocolArgument = '%1' } = options
  return (
    `"${powershell}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass` +
    ` -File "${script}" -Scheme "${scheme}" -Port ${port} -Token "${token}" "${protocolArgument}"`
  )
}

/** How long a registry write may take before it is treated as failed. */
const REG_TIMEOUT_MS = 10_000

/**
 * Run one `reg.exe` verb.
 *
 * @param args - verb and operands.
 * @returns the process exit code plus captured output.
 */
function runReg(args) {
  return new Promise((resolve) => {
    execFile(
      pathWin32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'),
      args,
      { windowsHide: true, timeout: REG_TIMEOUT_MS },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          code: error === null ? 0 : (error.code ?? 1),
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })
}

/**
 * Register the plugin's URL protocol for the CURRENT USER.
 *
 * `HKCU\Software\Classes` is the per-user protocol store: no elevation, no
 * machine-wide side effect, and removing the key is a complete undo. Windows
 * resolves `dsh-notice:<anything>` to this command line, which is how a click on
 * a toast reaches the running host.
 *
 * @param options - `scheme`, and the command line to run.
 * @returns the outcome, never a throw.
 */
export async function registerProtocol(options) {
  const { scheme, command } = options
  if (!isSupported()) return { ok: false, message: 'Windows only' }
  const key = protocolKey(scheme)
  const steps = [
    ['add', key, '/ve', '/d', `URL:${scheme} protocol`, '/f'],
    ['add', key, '/v', 'URL Protocol', '/d', '', '/f'],
    ['add', `${key}\\shell\\open\\command`, '/ve', '/d', command, '/f'],
  ]
  for (const args of steps) {
    const result = await runReg(args)
    if (!result.ok) {
      return { ok: false, message: `reg ${args[0]} ${args[1]} failed: ${result.stderr.trim() || result.stdout.trim()}` }
    }
  }
  return { ok: true, message: `registered ${scheme}: for the current user` }
}

/**
 * Remove this plugin's per-user protocol registration.
 *
 * Absence is success: the key may never have been written, or the user may have
 * removed it by hand.
 *
 * @param scheme - protocol scheme to forget.
 * @returns the outcome, never a throw.
 */
export async function unregisterProtocol(scheme) {
  if (!isSupported()) return { ok: false, message: 'Windows only' }
  const result = await runReg(['delete', protocolKey(scheme), '/f'])
  return { ok: true, message: result.ok ? `removed ${scheme}:` : `${scheme}: was not registered` }
}

/**
 * Read back the command Windows would run for this scheme, so the settings page
 * can show whether the registration is the plugin's own and still current.
 *
 * @param scheme - protocol scheme to inspect.
 * @returns the stored command line, or null when nothing is registered.
 */
export async function readProtocolCommand(scheme) {
  if (!isSupported()) return null
  const result = await runReg(['query', `${protocolKey(scheme)}\\shell\\open\\command`, '/ve'])
  if (!result.ok) return null
  const match = /REG_SZ\s+(.*)$/m.exec(result.stdout)
  return match === null ? null : match[1].trim()
}

/**
 * Bring the DeepSeek Harness desktop window to the front.
 *
 * The desktop app registers `dsh:` as a protocol and focuses its primary window
 * for `dsh://open`; on Windows the activation starts a second instance which
 * immediately yields to the first through the single-instance lock. Doing this
 * from the host (rather than as the toast's own activation) lets the toast
 * activation carry the session id instead of the focus request.
 *
 * @returns the outcome, never a throw.
 */
export function focusDesktopWindow() {
  if (!isSupported()) return { ok: false, message: 'Windows only' }
  return new Promise((resolve) => {
    execFile(
      'cmd.exe',
      ['/c', 'start', '', 'dsh://open'],
      { windowsHide: true, timeout: REG_TIMEOUT_MS },
      (error) => resolve(error === null ? { ok: true } : { ok: false, message: String(error.message) }),
    )
  })
}
