/**
 * dsh-workspace-plus/notice — choosing and building the click launcher.
 *
 * A click on a notification has to leave the host process: Windows resolves the
 * toast's protocol activation by running the command line this plugin wrote under
 * `HKCU\Software\Classes\<scheme>\shell\open\command`, and that command line can
 * only name an executable. Three launch strategies exist, and this module is the
 * one place that decides between them:
 *
 *   'helper'               a small compiled C# program shipped as source
 *                          (`click-host.cs`) and built on first use with the .NET
 *                          Framework compiler that every Windows install carries.
 *                          It is a GUI-subsystem executable, so Windows never
 *                          creates a console or a terminal host for it — which is
 *                          the whole point. The PowerShell launcher used to flash
 *                          a full Windows Terminal window for seconds on machines
 *                          where Windows Terminal is the default terminal.
 *   'windowless-powershell' the PowerShell fallback, started through
 *                          `conhost.exe --headless` so the console host that would
 *                          otherwise be spawned by the default terminal is asked
 *                          for no window at all.
 *   'powershell'           the original plain `powershell.exe -WindowStyle Hidden`
 *                          command, kept as the last resort for a machine without
 *                          a usable compiler or conhost.
 *
 * Building the helper must never be a hard dependency of the plugin: a locked-down
 * or broken .NET installation may have no compiler, and notifications must keep
 * working. So the build is attempted lazily, its failure is a Chinese message
 * rather than an exception, and `selectLauncher` falls back instead of failing.
 *
 * The module also owns the exact command-line shapes. Every argument is quoted,
 * because `%1` is replaced by Windows with the activated URL and a toast launch
 * string may legitimately contain `&`; an unquoted argument would split it.
 *
 * @module dsh-workspace-plus/notice/launcher
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, win32 as pathWin32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './settings.js'
import { conhostPath, powershellPath, protocolCommand } from './win32.js'

/**
 * Version of `click-host.cs`.
 *
 * The compiled executable lives in the user's DSH home rather than beside the
 * source, because the plugin directory may be read-only (an installed bundle) and
 * because a rebuild must not race an install. A file timestamp alone therefore
 * cannot prove that an existing executable matches the shipped source (a copied
 * or restored file can look newer than the source), so a sidecar file records
 * this version and a mismatch forces a rebuild. Bump it whenever
 * `click-host.cs` changes.
 */
export const CLICK_HOST_VERSION = '1.2.0'

/** Directory of this module on disk. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Absolute path of the C# source the helper is built from. */
export const CLICK_HOST_SOURCE = join(MODULE_DIR, 'click-host.cs')

/** Absolute path of the PowerShell fallback launcher. */
export const CLICK_SCRIPT = join(MODULE_DIR, 'click.ps1')

/** How long one `csc.exe` invocation may take before it is treated as hung. */
const COMPILE_TIMEOUT_MS = 30_000

/** How long the freshly built helper's `--selftest` run may take. */
const SELFTEST_TIMEOUT_MS = 10_000

/** File name of the version sidecar written next to the built executable. */
const VERSION_SUFFIX = '.version'

/**
 * Absolute path of the compiled click helper inside the DSH home.
 *
 * The executable is per-user runtime state, not a shipped asset: it belongs with
 * the settings and the toast daemon bookkeeping under `$DSH_HOME/notice`.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the executable path, whether or not it has been built yet.
 */
export function clickHostExePath(env = process.env) {
  return join(dshHome(env), 'notice', 'click-host.exe')
}

/**
 * Locate the .NET Framework C# compiler shipped with Windows.
 *
 * The Framework 4.0 compiler is used rather than a newer Roslyn because it is
 * present by default on every Windows 10/11 install and needs no SDK, package
 * manager or NuGet cache. The 64-bit directory is preferred and the 32-bit one
 * is the fallback for a machine where only that half of the framework is intact.
 *
 * @param options - environment, platform and filesystem probe overrides.
 * @returns the absolute `csc.exe` path, or null when none exists.
 */
export function findCsc(options = {}) {
  const { env = process.env, platform = process.platform, exists = existsSync } = options
  if (platform !== 'win32') return null
  const root = typeof env.SystemRoot === 'string' && env.SystemRoot !== '' ? env.SystemRoot : 'C:\\Windows'
  const candidates = [
    pathWin32.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    pathWin32.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Normalize the focus argument to the helper's `0`/`1` spelling.
 *
 * The registry command is a string, and boolean `false` reaching it as the word
 * "false" would make the helper treat it as truthy; normalizing here keeps the
 * command line unambiguous.
 *
 * @param focus - boolean-ish focus preference.
 * @returns `'1'` or `'0'`.
 */
function focusFlag(focus) {
  if (focus === false || focus === 0) return '0'
  if (typeof focus === 'string') {
    const text = focus.trim().toLowerCase()
    if (text === '0' || text === 'false' || text === 'off' || text === 'no') return '0'
  }
  return '1'
}

/**
 * The registry command line for the compiled helper.
 *
 * `%1` is Windows' placeholder for the activated URL and is quoted like every
 * other argument: the URL carries the plugin's own query string, whose `&` would
 * otherwise end the argument.
 *
 * @param options - executable, port, token, focus flag and protocol placeholder.
 * @returns the command line to store in the registry.
 */
export function clickHostCommand(options) {
  const { exe, port, token, focus = true, protocolArgument = '%1' } = options
  return `"${exe}" "${port}" "${token}" "${focusFlag(focus)}" "${protocolArgument}"`
}

/**
 * The registry command line for the windowless PowerShell fallback.
 *
 * `conhost.exe --headless` runs the child console process without a console host
 * window. That is the only reliable way to hide the terminal host: with Windows
 * Terminal as the default terminal, `powershell.exe -WindowStyle Hidden` hides
 * PowerShell's own window but the terminal host it is attached to is a separate
 * window that still appears.
 *
 * @param options - conhost, interpreter, script, scheme, port and token.
 * @returns the command line to store in the registry.
 */
export function windowlessPowerShellCommand(options) {
  const { conhost, powershell, script, scheme, port, token, protocolArgument = '%1' } = options
  return (
    `"${conhost}" --headless "${powershell}" -NoProfile -NonInteractive -ExecutionPolicy Bypass` +
    ` -File "${script}" -Scheme "${scheme}" -Port ${port} -Token "${token}" "${protocolArgument}"`
  )
}

/**
 * Pick the best launcher for the machine.
 *
 * Pure, so the preference order is testable without a Windows install: a built
 * helper is always best (no console at all), conhost is next (no window), and
 * plain PowerShell is the fallback that works everywhere Windows does.
 *
 * @param options - availability of the helper and of conhost.
 * @returns one of `'helper'`, `'windowless-powershell'`, `'powershell'`.
 */
export function chooseLauncherKind(options = {}) {
  const { helper, conhost } = options
  if (helper) return 'helper'
  if (conhost) return 'windowless-powershell'
  return 'powershell'
}

/**
 * Run one child process hidden and wait for it, bounded by a timeout.
 *
 * `windowsHide: true` matters here even though both programs involved are console
 * programs: `csc.exe` would otherwise flash a console window, and the selftest is
 * run while the user may be clicking a notification.
 *
 * @param command - executable to run.
 * @param args - argument list.
 * @param options - timeout plus a `spawn` override for tests.
 * @returns `{ ok, code, timedOut, message? }`, never a throw.
 */
function runProcess(command, args, options = {}) {
  const { timeout = 0, spawn: spawnChild = spawn } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawnChild(command, args, { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      resolve({ ok: false, code: -1, timedOut: false, message: String((error && error.message) || error) })
      return
    }

    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(result)
    }

    if (timeout > 0) {
      timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // The process may have exited between the timeout and the kill.
        }
        finish({ ok: false, code: -1, timedOut: true, message: `超时（${timeout} 毫秒）` })
      }, timeout)
    }

    child.on('error', (error) => {
      finish({ ok: false, code: -1, timedOut: false, message: String((error && error.message) || error) })
    })
    child.on('exit', (code) => {
      finish({ ok: code === 0, code: code === null ? -1 : code, timedOut: false })
    })
  })
}

/**
 * Whether an already built helper is current.
 *
 * Three independent facts have to agree, and any doubt means "rebuild": the
 * executable exists, it is not older than the source (a fresh plugin install must
 * not keep a stale binary), and the sidecar names the version shipped by this
 * module (a source edit without a timestamp relationship still bumps the id).
 *
 * @param options - paths plus filesystem probe/stat overrides.
 * @returns true when the existing executable can be used as-is.
 */
function clickHostIsCurrent(options) {
  const { exePath, source, exists, stat } = options
  if (!exists(exePath)) return false
  let executableStat
  let sourceStat
  try {
    executableStat = stat(exePath)
    sourceStat = stat(source)
  } catch {
    return false
  }
  if (!(executableStat.mtimeMs >= sourceStat.mtimeMs)) return false
  try {
    return readFileSync(`${exePath}${VERSION_SUFFIX}`, 'utf8').trim() === CLICK_HOST_VERSION
  } catch {
    return false
  }
}

/**
 * Build the click helper if the cached executable is missing or stale.
 *
 * The compile is done by `csc.exe` straight from the shipped source — there is no
 * build tooling in this repo, and requiring one would make the plugin unbuildable
 * on a machine that merely runs the Harness. The output is written to a temporary
 * name first and only renamed into place after the binary itself proved it starts
 * (`--selftest`), so a half-written or broken executable can never be picked up by
 * a later registration. A rebuild of an existing executable is slightly less
 * atomic on Windows because rename cannot replace a file; the previous binary is
 * therefore removed immediately before the rename, and any failure leaves the
 * temporary file deleted rather than lying around.
 *
 * Never throws: the caller gets a Chinese message that ends up in the host log or
 * the settings page, and the launcher selection falls back to PowerShell.
 *
 * @param options - paths, compiler, filesystem and process overrides for tests.
 * @returns `{ ok, exe, built, message }`.
 */
export async function ensureClickHost(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    source = CLICK_HOST_SOURCE,
    exePath = clickHostExePath(env),
    csc,
    exists = existsSync,
    stat = statSync,
    force = false,
    spawn: spawnChild,
    run = runProcess,
  } = options

  const failed = (message) => ({ ok: false, exe: exePath, built: false, message })

  try {
    if (platform !== 'win32') return failed('仅 Windows 需要编译点击助手')

    if (force !== true && clickHostIsCurrent({ exePath, source, exists, stat })) {
      return { ok: true, exe: exePath, built: false, message: '点击助手已是最新，无需编译' }
    }

    const compiler = csc === undefined ? findCsc({ env, platform, exists }) : csc
    if (typeof compiler !== 'string' || compiler === '' || !exists(compiler)) {
      return failed('未找到 .NET Framework 4.0 的 csc.exe，无法编译点击助手')
    }
    if (!exists(source)) return failed(`缺少点击助手源码：${source}`)

    try {
      mkdirSync(dirname(exePath), { recursive: true })
    } catch (error) {
      return failed(`无法创建点击助手目录：${String((error && error.message) || error)}`)
    }

    // The temporary name stays in the target directory: a rename across
    // directories is not atomic, and the DSH home may sit on another volume.
    const temporary = `${exePath}.${process.pid}.${Date.now()}.tmp`
    const runOptions = spawnChild === undefined ? {} : { spawn: spawnChild }
    const startedAt = Date.now()

    try {
      // The source file must come after the options: csc.exe's command line is
      // order-sensitive and rejects `/out` and `/target` once it has seen an
      // input file (CS2022), so the flags are kept together in front.
      const build = await run(
        compiler,
        ['/nologo', '/target:winexe', '/optimize+', `/out:${temporary}`, source],
        { ...runOptions, timeout: COMPILE_TIMEOUT_MS },
      )
      if (build === null || build === undefined || build.ok !== true) {
        const reason = build === null || build === undefined ? '没有返回结果' : String(build.message ?? `csc 退出码 ${build.code}`)
        return failed(`点击助手编译失败：${reason}`)
      }

      // A binary that cannot even start is worse than no binary: the protocol
      // registration would point at something that silently does nothing, and a
      // later click would never learn why. The exit code is the whole check.
      const selftest = await run(temporary, ['--selftest'], { ...runOptions, timeout: SELFTEST_TIMEOUT_MS })
      if (selftest === null || selftest === undefined || selftest.ok !== true) {
        const reason = selftest === null || selftest === undefined ? '没有返回结果' : String(selftest.message ?? `--selftest 退出码 ${selftest.code}`)
        return failed(`点击助手自检失败：${reason}`)
      }

      try {
        renameSync(temporary, exePath)
      } catch {
        // Windows will not rename over an existing file. Removing the old binary
        // first is the only option; the window in which neither exists is one
        // filesystem operation long and a click arriving in it simply falls back.
        rmSync(exePath, { force: true })
        renameSync(temporary, exePath)
      }
    } finally {
      // No-op after a successful rename; on every failure path it removes the
      // half-built executable so the next attempt starts clean.
      rmSync(temporary, { force: true })
    }

    try {
      writeFileSync(`${exePath}${VERSION_SUFFIX}`, `${CLICK_HOST_VERSION}\n`, 'utf8')
    } catch {
      // The executable itself is fine; without the sidecar the next check simply
      // rebuilds it. Not worth failing the registration over.
    }

    const elapsed = Date.now() - startedAt
    return { ok: true, exe: exePath, built: true, message: `已编译点击助手（${elapsed} 毫秒）` }
  } catch (error) {
    return failed(`点击助手构建失败：${String((error && error.message) || error)}`)
  }
}

/**
 * Decide how a click should be launched on this machine.
 *
 * Always asks `ensureClickHost` first, then chooses the best command from what is
 * actually available. A failed build is not a failed registration: the point of
 * the fallbacks is that a machine without a usable compiler still gets clickable
 * notifications, just with the older console-hosting strategy.
 *
 * @param options - scheme, port, token, focus preference and overrides for tests.
 * @returns `{ ok, kind, command, exe, message }`.
 */
export async function selectLauncher(options = {}) {
  const {
    scheme,
    port,
    token,
    focus = true,
    env = process.env,
    platform = process.platform,
    powershell = powershellPath(env),
    conhost = conhostPath(env),
    script = CLICK_SCRIPT,
    exists = existsSync,
    stat = statSync,
    csc,
    ensureClickHost: ensure = ensureClickHost,
  } = options

  const exe = clickHostExePath(env)
  const failed = (message) => ({ ok: false, kind: 'powershell', command: '', exe, message })

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return failed('尚未获知 Harness 监听端口，无法生成点击命令')
  }

  let buildMessage = ''
  let helperAvailable = false
  try {
    const ensured = await ensure({ env, platform, source: CLICK_HOST_SOURCE, exePath: exe, csc, exists, stat })
    helperAvailable = ensured !== null && ensured !== undefined && ensured.ok === true
    buildMessage = String(ensured?.message ?? '')
  } catch (error) {
    // A broken build path must degrade, not abort the registration.
    buildMessage = `点击助手不可用：${String((error && error.message) || error)}`
  }

  // conhost is only meaningful on Windows, and only when the file is really
  // there: a command naming a missing executable would make every click do
  // nothing, which is worse than a visible console window.
  const conhostAvailable =
    platform === 'win32' && typeof conhost === 'string' && conhost !== '' && exists(conhost)

  const kind = chooseLauncherKind({ helper: helperAvailable, conhost: conhostAvailable })
  const commandOptions = { port, token, focus }
  let command
  let message
  if (kind === 'helper') {
    command = clickHostCommand({ ...commandOptions, exe })
    message = '点击通知将直接唤起 Harness 窗口（编译版点击助手，无控制台窗口）'
  } else if (kind === 'windowless-powershell') {
    command = windowlessPowerShellCommand({ ...commandOptions, conhost, powershell, script, scheme })
    message = `点击助手不可用（${buildMessage === '' ? '未知原因' : buildMessage}），改用 conhost --headless 隐藏控制台的 PowerShell 启动器`
  } else {
    command = protocolCommand({ powershell, script, scheme, port, token })
    message = `点击助手与 conhost 均不可用（${buildMessage === '' ? '未知原因' : buildMessage}），回退到普通 PowerShell 启动器（可能短暂出现控制台窗口）`
  }

  return { ok: true, kind, command, exe, message }
}
