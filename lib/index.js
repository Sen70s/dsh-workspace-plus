/**
 * dsh-workspace-plus — host half.
 *
 * Feature 2: a DSH workspace keeps ONE directory (`SessionHeader.cwd`), but a
 * real project often spans several roots (a frontend repo, a backend repo, a
 * docs folder). This half lets one workspace carry N extra directories, each
 * with a short **label**, and makes those labels usable in conversation:
 *
 *   1. a durable, plugin-owned store: workspace path -> [{ label, path, note }]
 *   2. a per-request runtime-context contribution (`workspaceplus:directories`)
 *      that renders the label table for the calling Session's workspace, so the
 *      agent sees the mapping without spending a tool call
 *   3. a `workspace_dirs` Tool the agent uses to inspect or edit the mapping
 *      when the user asks in natural language
 *   4. a small JSON HTTP route the browser half uses to manage the same store
 *
 * The whole point is routing by label instead of by guesswork: the injected
 * table gives absolute paths, so a similar-looking directory name elsewhere on
 * disk cannot capture the edit.
 *
 * The module deliberately imports nothing but Node builtins: an externally
 * installed bundle cannot rely on resolving `@deepseek-ai/*` from its own
 * location, and the two contracts it needs (`systemPrompt.context({...})` and
 * the registry-ready tool definition shape) are plain data.
 *
 * @module dsh-workspace-plus
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Plugin name shown by the loader and in host logs. */
export const name = 'dsh-workspace-plus'

/** Services the two contributions require; both ship in the base composition. */
export const inject = ['tools', 'systemPrompt']

/** Runtime-context entry name (stable: it is also the contribution's identity). */
export const CONTEXT_NAME = 'workspaceplus:directories'

/**
 * Runtime-context order. The shipped runtime contexts sit in the 110-120 band
 * (sandbox policy, approval policy, subagent delegation); 130 places the
 * directory table right after them, where it reads as part of the same
 * "where am I allowed to work" block.
 */
export const CONTEXT_ORDER = 130

/** On-disk state format version. */
export const STATE_VERSION = 1

/** Tool name exposed to the model. */
export const TOOL_NAME = 'workspace_dirs'

/** HTTP route the browser half reads and writes. */
export const API_PATH = '/workspaceplus/api'

/**
 * Plugin settings and their defaults. `defaultWorkspaceEnabled` is deliberately
 * `false`: the default (first-use) Workspace belongs to the product, not to this
 * plugin, so label routing stays inert there until the user turns it on from the
 * `workspace+` settings page.
 */
export const DEFAULT_SETTINGS = { defaultWorkspaceEnabled: false }

/** Settings key of the default-workspace switch. */
export const DEFAULT_WORKSPACE_SETTING = 'defaultWorkspaceEnabled'

/** Label grammar: short, shell-friendly, unambiguous in prose. */
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

/** Labels that would read as a path or a pronoun in prose and only cause confusion. */
const RESERVED_LABELS = new Set(['.', '..', 'cwd', 'root', 'this', 'workspace'])

// ---------------------------------------------------------------------------
// Pure helpers (exported for tools/verify.mjs)
// ---------------------------------------------------------------------------

/**
 * Locate the Harness home the same way the rest of the harness does: the
 * `DSH_HOME` environment variable when the host process carries it, otherwise
 * the default `~/.dsh`.
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
 * Absolute path of this plugin's state file.
 *
 * @param env - environment snapshot (injectable for tests).
 * @returns the state file path.
 */
export function stateFilePath(env = process.env) {
  return join(dshHome(env), 'workspaceplus', 'directories.json')
}

/**
 * Comparison key for a directory path. Windows paths are case-insensitive, so
 * the key folds case there and keeps the platform's own spelling elsewhere.
 *
 * @param path - any absolute or relative path.
 * @returns the stable lookup key.
 */
export function keyOf(path) {
  const absolute = resolve(String(path))
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** @returns an empty, valid state object. */
export function emptyState() {
  return { version: STATE_VERSION, settings: { ...DEFAULT_SETTINGS }, workspaces: {} }
}

/**
 * Normalize the settings block, filling in every default for anything missing or
 * malformed. An older state file without a `settings` key keeps working.
 *
 * @param raw - the parsed `settings` value, or anything else.
 * @returns a complete settings object.
 */
export function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return settings
  if (typeof raw[DEFAULT_WORKSPACE_SETTING] === 'boolean') {
    settings[DEFAULT_WORKSPACE_SETTING] = raw[DEFAULT_WORKSPACE_SETTING]
  }
  return settings
}

/**
 * Validate and normalize a parsed state document. Unknown shapes degrade to an
 * empty state rather than throwing, because a corrupt state file must not stop
 * the Harness from booting.
 *
 * @param raw - parsed JSON, or anything else.
 * @returns a normalized state object.
 */
export function normalizeState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyState()
  const workspaces = raw.workspaces
  if (workspaces === null || typeof workspaces !== 'object' || Array.isArray(workspaces)) return emptyState()
  const next = emptyState()
  next.settings = normalizeSettings(raw.settings)
  for (const [key, entry] of Object.entries(workspaces)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const path = typeof entry.path === 'string' && entry.path !== '' ? entry.path : key
    const dirs = []
    const seen = new Set()
    for (const dir of Array.isArray(entry.dirs) ? entry.dirs : []) {
      if (dir === null || typeof dir !== 'object' || Array.isArray(dir)) continue
      const label = typeof dir.label === 'string' ? dir.label.trim() : ''
      const dirPath = typeof dir.path === 'string' ? dir.path.trim() : ''
      if (!LABEL_PATTERN.test(label) || dirPath === '') continue
      const labelKey = label.toLowerCase()
      if (seen.has(labelKey)) continue
      seen.add(labelKey)
      dirs.push({
        label,
        path: resolve(dirPath),
        ...(typeof dir.note === 'string' && dir.note.trim() !== '' ? { note: dir.note.trim() } : {}),
      })
    }
    next.workspaces[keyOf(path)] = { path: resolve(path), dirs }
  }
  return next
}

/**
 * Read the state file, tolerating a missing, unreadable, or corrupt file.
 *
 * @param file - state file path.
 * @returns the normalized state.
 */
export function readState(file) {
  try {
    return normalizeState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return emptyState()
  }
}

/**
 * Persist the state atomically (write a sibling temp file, then rename), so a
 * crash mid-write cannot leave a half-written mapping behind.
 *
 * @param file - state file path.
 * @param state - the state to persist.
 */
export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/**
 * Whether the label routing runs for one workspace.
 *
 * The default (first-use) Workspace is the product's, not this plugin's: it stays
 * inert unless the user enables the switch on the `workspace+` settings page.
 * Every other workspace is enabled by definition.
 *
 * @param options - the settings, the workspace path, and the resolved default path.
 * @returns true when the feature should run for that workspace.
 */
export function isFeatureEnabledFor({ settings, workspacePath, defaultWorkspacePath }) {
  if (defaultWorkspacePath === null || defaultWorkspacePath === undefined) return true
  if (keyOf(workspacePath) !== keyOf(defaultWorkspacePath)) return true
  return normalizeSettings(settings)[DEFAULT_WORKSPACE_SETTING] === true
}

/**
 * Apply one settings mutation.
 *
 * @param state - normalized state (mutated only when the operation succeeds).
 * @param patch - the requested settings values.
 * @returns `{ ok, message, settings }`.
 */
export function applySettings(state, patch) {
  const wanted = patch?.[DEFAULT_WORKSPACE_SETTING]
  if (typeof wanted !== 'boolean') {
    return { ok: false, message: `${DEFAULT_WORKSPACE_SETTING} 必须是布尔值`, settings: state.settings }
  }
  state.settings = { ...normalizeSettings(state.settings), [DEFAULT_WORKSPACE_SETTING]: wanted }
  return {
    ok: true,
    settings: state.settings,
    message: wanted ? '已对默认工作区启用 workspace+' : '已对默认工作区停用 workspace+',
  }
}

/**
 * The labeled directories registered for one workspace directory.
 *
 * @param state - normalized state.
 * @param workspacePath - the workspace's directory.
 * @returns its entry, or undefined when nothing is registered.
 */
export function entryFor(state, workspacePath) {
  return state.workspaces[keyOf(workspacePath)]
}

/**
 * Validate one directory a user wants to register.
 *
 * @param path - the candidate directory.
 * @returns `{ ok: true, path }` or `{ ok: false, message }`.
 */
export function validateDirectory(path) {
  const text = String(path ?? '').trim()
  if (text === '') return { ok: false, message: 'path 不能为空' }
  if (!isAbsolute(text)) return { ok: false, message: `path 必须是绝对路径：${text}` }
  const absolute = resolve(text)
  if (!existsSync(absolute)) return { ok: false, message: `目录不存在：${absolute}` }
  try {
    if (!statSync(absolute).isDirectory()) return { ok: false, message: `不是目录：${absolute}` }
  } catch (error) {
    return { ok: false, message: `无法访问 ${absolute}：${String(error?.message ?? error)}` }
  }
  return { ok: true, path: absolute }
}

/**
 * Validate a label.
 *
 * @param label - the candidate label.
 * @returns `{ ok: true, label }` or `{ ok: false, message }`.
 */
export function validateLabel(label) {
  const text = String(label ?? '').trim()
  if (text === '') return { ok: false, message: 'label 不能为空' }
  if (!LABEL_PATTERN.test(text)) {
    return { ok: false, message: `label 只能是字母/数字/. _ -，且不超过 32 个字符：${text}` }
  }
  if (RESERVED_LABELS.has(text.toLowerCase())) return { ok: false, message: `label 不能使用保留字：${text}` }
  return { ok: true, label: text }
}

/**
 * Apply one store operation. Every branch validates first and returns a
 * discriminated result, so both the Tool and the HTTP route share one behavior
 * and one set of messages.
 *
 * @param state - normalized state (mutated only when the operation succeeds).
 * @param operation - `{ op: 'add' | 'remove' | 'update', workspace, label, path, note }`.
 * @returns `{ ok: true, message, entry }` or `{ ok: false, message }`.
 */
export function applyOperation(state, operation) {
  const workspaceCheck = validateDirectory(operation.workspace)
  if (!workspaceCheck.ok) return { ok: false, message: `工作区目录无效：${workspaceCheck.message}` }
  const workspacePath = workspaceCheck.path
  const key = keyOf(workspacePath)
  const current = state.workspaces[key] ?? { path: workspacePath, dirs: [] }

  const labelCheck = validateLabel(operation.label)
  if (!labelCheck.ok) return labelCheck
  const labelKey = labelCheck.label.toLowerCase()
  const at = current.dirs.findIndex((dir) => dir.label.toLowerCase() === labelKey)

  if (operation.op === 'add') {
    if (at !== -1) {
      return { ok: false, message: `标签 ${current.dirs[at].label} 已存在（指向 ${current.dirs[at].path}）。要改路径请用 update。` }
    }
    const directoryCheck = validateDirectory(operation.path)
    if (!directoryCheck.ok) return directoryCheck
    current.dirs.push({
      label: labelCheck.label,
      path: directoryCheck.path,
      ...(typeof operation.note === 'string' && operation.note.trim() !== '' ? { note: operation.note.trim() } : {}),
    })
    state.workspaces[key] = current
    return { ok: true, entry: current, message: `已为工作区 ${workspacePath} 登记 ${labelCheck.label} -> ${directoryCheck.path}` }
  }

  if (operation.op === 'remove') {
    if (at === -1) return { ok: false, message: `工作区 ${workspacePath} 没有标签 ${labelCheck.label}` }
    const [removed] = current.dirs.splice(at, 1)
    if (current.dirs.length === 0) delete state.workspaces[key]
    else state.workspaces[key] = current
    return { ok: true, entry: current.dirs.length === 0 ? { path: workspacePath, dirs: [] } : current, message: `已移除标签 ${removed.label}（${removed.path}）` }
  }

  if (operation.op === 'update') {
    if (at === -1) return { ok: false, message: `工作区 ${workspacePath} 没有标签 ${labelCheck.label}；新增请用 add` }
    const target = { ...current.dirs[at] }
    if (operation.path !== undefined && operation.path !== null && String(operation.path).trim() !== '') {
      const directoryCheck = validateDirectory(operation.path)
      if (!directoryCheck.ok) return directoryCheck
      target.path = directoryCheck.path
    }
    if (operation.note !== undefined) {
      const note = String(operation.note).trim()
      if (note === '') delete target.note
      else target.note = note
    }
    current.dirs[at] = target
    state.workspaces[key] = current
    return { ok: true, entry: current, message: `已更新标签 ${target.label} -> ${target.path}` }
  }

  return { ok: false, message: `未知操作：${String(operation.op)}` }
}

/**
 * Render one workspace's mapping for the model. Returns an empty string when
 * the workspace has no registered directories, so an unused feature costs no
 * prompt bytes.
 *
 * @param options - workspace path, its entry, and the effective sandbox facts.
 * @returns the runtime-context text, or `''`.
 */
export function renderDirectoryContext({ workspacePath, entry, sandboxMode }) {
  if (entry === undefined || !Array.isArray(entry.dirs) || entry.dirs.length === 0) return ''
  const restricted = sandboxMode !== undefined && sandboxMode !== 'danger-full-access'
  const inside = (dir) => keyOf(dir) === keyOf(workspacePath) || keyOf(dir).startsWith(`${keyOf(workspacePath)}\\`) || keyOf(dir).startsWith(`${keyOf(workspacePath)}/`)

  const lines = [
    '工作区多目录映射（dsh-workspace-plus 插件维护）',
    '',
    `当前会话的 cwd（工作区根目录）：\`${workspacePath}\``,
    '',
    '用户提到下列「标签」时，指的就是表中对应的绝对目录。请直接使用表中的绝对路径，',
    '不要根据目录名相似、命名习惯或当前 cwd 去推测位置：',
    '',
  ]
  for (const dir of entry.dirs) {
    const note = dir.note === undefined ? '' : `（${dir.note}）`
    const outside = restricted && !inside(dir.path) ? ' ⚠ 在工作区根目录之外' : ''
    lines.push(`- \`${dir.label}\` → \`${dir.path}\`${note}${outside}`)
  }
  lines.push(
    '',
    '规则：',
    '1. 读写、编辑、搜索和命令中的路径都使用上表的绝对路径；不要把它当作相对于 cwd 的相对路径。',
    '2. 标签不区分大小写。',
    `3. 只在上表列出的目录和工作区根目录 \`${workspacePath}\` 内工作。不要扫描 cwd 的同级目录，也不要用 \`**/*\` 这类无范围模式在 cwd 下“先找找看”——要定位文件时，先用标签选定目录，再在该目录内按模式搜索。`,
    '4. 上表没有覆盖的路径，先调用 workspace_dirs 工具确认，不要猜。',
    '5. 用户要求增删改这份映射时，调用 workspace_dirs 工具，不要直接编辑状态文件。',
  )
  if (restricted) {
    lines.push(
      `6. 当前文件策略为 ${sandboxMode}：只有工作区根目录内的文件可直接写；标有 ⚠ 的目录需要工具自身的升级流程` +
        '（如 write/edit 的 sandbox_permissions + justification），按工具返回的提示处理，不要因为它不在工作区内就直接放弃，也不要反复重试同一次写入。',
    )
  }
  return lines.join('\n')
}

/**
 * Render one workspace's mapping for a human/agent tool result.
 *
 * @param workspacePath - the workspace directory.
 * @param entry - its registered directories.
 * @returns a readable multi-line summary.
 */
export function renderDirectoryList(workspacePath, entry) {
  if (entry === undefined || entry.dirs.length === 0) {
    return `工作区 ${workspacePath} 还没有登记任何目录。用 workspace_dirs add 添加，例如：\n  action=add, workspace=${workspacePath}, label=backend, path=D:\\proj\\backend`
  }
  const lines = [`工作区 ${workspacePath} 已登记 ${entry.dirs.length} 个目录：`]
  for (const dir of entry.dirs) {
    lines.push(`- ${dir.label} -> ${dir.path}${dir.note === undefined ? '' : `  (${dir.note})`}`)
  }
  return lines.join('\n')
}

/** The closed action vocabulary of the `workspace_dirs` tool. */
export const TOOL_ACTIONS = ['list', 'add', 'remove', 'update']

/** The model-facing parameter schema of the `workspace_dirs` tool. */
export const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: TOOL_ACTIONS,
      description:
        'list reads the mapping; add registers a new labeled directory; remove drops a label; update changes a label\'s path or note.',
    },
    label: {
      type: 'string',
      description: 'Conversation label for the directory. Required for add/remove/update (letters, digits, ".", "_", "-", max 32).',
    },
    path: {
      type: 'string',
      description: 'Absolute directory path: required for add, optional for update (re-points the label).',
    },
    note: {
      type: 'string',
      description: 'Optional one-line description, shown to the agent and in the GUI.',
    },
    workspace: {
      type: 'string',
      description: 'Absolute path of the target workspace directory. Defaults to the calling session workspace (its cwd).',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

/** The model-facing description of the `workspace_dirs` tool. */
export const TOOL_DESCRIPTION = [
  'Read or edit the extra labeled directories registered for a DSH workspace.',
  'A workspace has one root (the session cwd); this tool maintains the additional project folders that belong to it,',
  'each addressed in conversation by a short label. The current mapping is already in your context; call this tool to',
  'confirm it, or when the user asks to add, remove or re-point a labeled directory.',
  'Never guess a directory from a similar name — resolve it here first.',
].join(' ')

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Host-side entry point. Wires the store to the three consumers (prompt
 * context, tool, HTTP route) and lets Cordis dispose all of them on unload.
 *
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  const file = stateFilePath()

  /**
   * Identity of the first-use (default) Workspace, resolved through the PUBLIC
   * registry API: `initializeDefault` returns the recorded default immediately
   * when one exists, returns `undefined` when automatic creation is ineligible,
   * and only ever calls the directory resolver when it would actually create a
   * workspace — so the probe passes a resolver that refuses, and a brand-new
   * install simply reports "no default workspace" instead of creating one.
   *
   * `resolved` stays false when the registry is not usable yet (its service is
   * registered before `[Service.init]` finishes, so `requireState()` can throw on
   * a cold boot). Every later caller retries, which keeps a failed first attempt
   * from silently enabling the feature on the default Workspace forever.
   */
  let defaultWorkspace = { resolved: false, id: null, path: null }

  const resolveDefaultWorkspace = async (registry = ctx.get('workspaceRegistry')) => {
    if (defaultWorkspace.resolved) return defaultWorkspace
    if (registry === undefined || typeof registry.initializeDefault !== 'function') return defaultWorkspace
    try {
      const workspace = await registry.initializeDefault(() => {
        throw new Error('dsh-workspace-plus: declined to create the default workspace')
      })
      defaultWorkspace = {
        resolved: true,
        id: workspace === undefined ? null : String(workspace.id),
        path: workspace === undefined ? null : workspace.path,
      }
    } catch {
      // Registry not started yet, or the probe was declined: retry on the next call.
    }
    return defaultWorkspace
  }

  /**
   * Warm the cache as soon as the registry service is usable — the synchronous
   * prompt path can then read a settled value from the very first request.
   */
  ctx.inject(['workspaceRegistry'], (registryScope) => {
    void resolveDefaultWorkspace(registryScope.workspaceRegistry)
  })

  /** Read-modify-write through the single state file, serialized per call. */
  const mutate = (operation) => {
    const state = readState(file)
    const result = applyOperation(state, operation)
    if (result.ok) writeState(file, state)
    return result
  }

  /** Read-modify-write for the settings block. */
  const mutateSettings = (patch) => {
    const state = readState(file)
    const result = applySettings(state, patch)
    if (result.ok) writeState(file, state)
    return result
  }

  /** Whether the feature runs for a workspace path, given the current settings and probe. */
  const enabledFor = (workspacePath, settings) =>
    isFeatureEnabledFor({ settings, workspacePath, defaultWorkspacePath: defaultWorkspace.path })

  const snapshot = () => {
    const registry = ctx.get('workspaceRegistry')
    const state = readState(file)
    const workspaces = registry === undefined ? [] : registry.list()
    return {
      registryAvailable: registry !== undefined,
      settings: { ...state.settings },
      defaultWorkspaceId: defaultWorkspace.id,
      defaultWorkspacePath: defaultWorkspace.path,
      workspaces: workspaces.map((workspace) => {
        const entry = entryFor(state, workspace.path)
        const isDefault = defaultWorkspace.path !== null && keyOf(defaultWorkspace.path) === keyOf(workspace.path)
        return {
          id: String(workspace.id),
          path: workspace.path,
          title: workspace.title,
          isDefault,
          enabled: enabledFor(workspace.path, state.settings),
          dirs: entry === undefined ? [] : entry.dirs.map((dir) => ({ ...dir })),
        }
      }),
    }
  }

  // --- 1. Make the label table part of every request in that workspace ------
  // `context()` and `register()` each install their own effect on this plugin's
  // fiber, so both contributions disappear when the plugin unloads.
  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    text: (context) => {
      const session = context.agent?.session
      const workspacePath = session?.header?.cwd
      if (typeof workspacePath !== 'string' || workspacePath === '') return ''
      const state = readState(file)
      // The default Workspace stays untouched until the user opts in.
      if (!enabledFor(workspacePath, state.settings)) return ''
      const entry = entryFor(state, workspacePath)
      if (entry === undefined || entry.dirs.length === 0) return ''
      const policy = ctx.get('sandboxPolicy')
      const sandboxMode = session === undefined ? undefined : policy?.resolve({ session })?.mode
      return renderDirectoryContext({ workspacePath, entry, sandboxMode })
    },
  })

  // --- 2. Let the agent inspect and edit the mapping ------------------------
  ctx.tools.register({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const session = exec.agent?.session
      const action = args?.action
      if (!TOOL_ACTIONS.includes(action)) {
        return `Error: action 必须是 ${TOOL_ACTIONS.join(' / ')} 之一，收到 ${JSON.stringify(action ?? null)}`
      }
      const workspace =
        typeof args.workspace === 'string' && args.workspace.trim() !== '' ? args.workspace : session?.header?.cwd
      if (typeof workspace !== 'string' || workspace === '') {
        return 'Error: 没有可用的工作区目录。请通过 workspace 参数显式指定一个绝对路径。'
      }
      // The tool can afford a fresh probe, so its gate is never decided on a
      // cache that a cold boot could not fill.
      await resolveDefaultWorkspace()
      const state = readState(file)
      if (!enabledFor(workspace, state.settings)) {
        return (
          `Error: ${resolve(workspace)} 是默认工作区，workspace+ 默认不对它启用。` +
          '请在 GUI 的 设置 → workspace+ 打开「对默认工作区启用」，或改用其它工作区。'
        )
      }
      if (action === 'list') {
        return renderDirectoryList(resolve(workspace), entryFor(state, workspace))
      }
      const result = mutate({
        op: action,
        workspace,
        label: args.label,
        path: args.path,
        note: args.note,
      })
      if (!result.ok) return `Error: ${result.message}`
      return `${result.message}\n\n${renderDirectoryList(resolve(workspace), result.entry)}`
    },
  })

  // --- 3. Give the browser half a same-origin JSON endpoint -----------------
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
              const body = JSON.stringify(payload)
              res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(body)
            }
            try {
              // The settings page must see the default-workspace identity even on
              // the very first request after boot, so the probe is awaited here.
              await resolveDefaultWorkspace()
              if (req.method === 'GET') {
                send(200, { ok: true, ...snapshot() })
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
                if (bytes > 64 * 1024) {
                  send(413, { ok: false, message: 'request body too large' })
                  return
                }
                chunks.push(chunk)
              }
              let payload
              try {
                payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              } catch {
                send(400, { ok: false, message: 'body is not JSON' })
                return
              }
              if (payload?.op === 'settings') {
                const settingsResult = mutateSettings(payload?.settings)
                if (!settingsResult.ok) {
                  send(200, { ok: false, message: settingsResult.message, ...snapshot() })
                  return
                }
                send(200, { ok: true, message: settingsResult.message, ...snapshot() })
                return
              }
              const operation = {
                op: payload?.op,
                workspace: payload?.workspace,
                label: payload?.label,
                path: payload?.path,
                note: payload?.note,
              }
              if (operation.op === undefined) {
                send(400, { ok: false, message: 'missing op' })
                return
              }
              const result = mutate(operation)
              if (!result.ok) {
                send(200, { ok: false, message: result.message, ...snapshot() })
                return
              }
              send(200, { ok: true, message: result.message, ...snapshot() })
            } catch (error) {
              ctx.logger?.warn?.(error)
              send(500, { ok: false, message: String(error?.message ?? error) })
            }
          },
        }),
      'dsh-workspace-plus: /workspaceplus/api route',
    )
  })

  console.log(`[${name}] host half loaded — workspace label routing is active (${file})`)
}
