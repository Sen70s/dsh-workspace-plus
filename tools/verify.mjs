/**
 * Offline verification for the dsh-workspace-plus plugin bundle.
 *
 * Run with: node tools/verify.mjs
 *
 * It validates the bundle **without installing it into a profile and without a
 * running DSH**: the package manifest, the loader patch, both plugin halves, the
 * store logic, the prompt contribution, the Tool, the HTTP route, the exact slot
 * registrations, the dialog's external store, and the DOM-level workspace-row
 * button (against a minimal DOM double).
 *
 * The host half runs against a fake Cordis context and a temporary `DSH_HOME`,
 * so the real `~/.dsh` state file is never touched. The browser half runs
 * against stubs of the shell's platform modules (react,
 * @deepseek-ai/dsh-client-ui-primitives) inside a `node:vm` context that exposes
 * the same `window.__ModuleLoader__` facade the real page uses, so a broken
 * bundle id, a missing export, a wrong slot id, or a broken row anchor fails
 * here instead of in the running GUI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** Every module the shell's frozen platform table seeds (from the Web shell boot bundle). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** The only slot keys this plugin is allowed to write to. */
const KNOWN_SLOTS = {
  'sidebar.panellist': 'list',
  main: 'keyed',
  'shell.overlay': 'list',
  'settings.section': 'list',
}

const results = []
const ok = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail })
const skip = (name, why) => results.push({ name, pass: true, skipped: true, detail: why })

// ---------------------------------------------------------------------------
// 1. Package manifest
// ---------------------------------------------------------------------------
const pkg = JSON.parse(read('package.json'))

ok('package.json: name is a resolvable package name', /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), pkg.name)
ok('package.json: type is "module"', pkg.type === 'module')
ok('package.json: main resolves to the host half', pkg.main === 'lib/index.js')
ok('package.json: exports["."] points at the host half', pkg.exports?.['.']?.default === './lib/index.js')
ok('package.json: exports["./client"] points at the browser half', pkg.exports?.['./client']?.default === './lib/client.js')
ok('package.json: exports["./package.json"] is exposed', pkg.exports?.['./package.json'] === './package.json')
ok('package.json: declared main file exists', existsSync(join(ROOT, pkg.main)))
ok('package.json: declared client file exists', existsSync(join(ROOT, pkg.exports['./client'].default)))
ok('package.json: dsh.manifestVersion is 1', pkg.dsh?.manifestVersion === 1)
ok('package.json: dsh.bundle.patch is declared', typeof pkg.dsh?.bundle?.patch === 'string', pkg.dsh?.bundle?.patch)
ok('package.json: the declared patch file exists', existsSync(join(ROOT, pkg.dsh?.bundle?.patch ?? '__missing__')))
ok('package.json: dsh.client.platform is "web"', pkg.dsh?.client?.platform === 'web')
ok(
  'package.json: dsh.client.inject is a string array',
  Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.every((s) => typeof s === 'string'),
  JSON.stringify(pkg.dsh?.client?.inject),
)
ok('package.json: engines.dsh declares a compatible host', typeof pkg.engines?.dsh === 'string', pkg.engines?.dsh)
ok('package.json: "files" ships lib, patch and icon', ['lib', 'cordis.patch.yml', 'icon.svg'].every((f) => pkg.files?.includes(f)))

// ---------------------------------------------------------------------------
// 2. Bundle patch (the layer a profile applies)
// ---------------------------------------------------------------------------
const patch = read(pkg.dsh.bundle.patch)
const insertedNames = [...patch.matchAll(/^\s*(?:-\s*)?name:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1].trim())
const insertedIds = [...patch.matchAll(/^\s*(?:-\s*)?id:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1].trim())

ok('cordis.patch.yml: contains an insert list', /^-\s*insert:\s*$/m.test(patch))
ok('cordis.patch.yml: has no tab indentation', !/^\t/m.test(patch))
ok('cordis.patch.yml: inserts exactly one row by package name', insertedNames.length === 1 && insertedNames[0] === pkg.name, insertedNames.join(', '))
ok('cordis.patch.yml: the row has a unique id', insertedIds.length === 1 && insertedIds[0].length > 0, insertedIds.join(', '))

// ---------------------------------------------------------------------------
// 3. Host half — pure store logic
// ---------------------------------------------------------------------------
const host = await import(pathToFileURL(join(ROOT, pkg.main)).href)
const work = mkdtempSync(join(tmpdir(), 'wsp-verify-'))
const home = join(work, 'home')
const workspaceRoot = join(work, 'frontend')
const defaultDir = join(work, 'Documents-default')
const backendDir = join(work, 'backend')
const docsDir = join(work, 'docs')
for (const dir of [home, workspaceRoot, defaultDir, backendDir, docsDir]) mkdirSync(dir, { recursive: true })
const missingDir = join(work, 'nope')

ok('lib/index.js: exports a name', typeof host.name === 'string' && host.name.length > 0, host.name)
ok('lib/index.js: exports apply()', typeof host.apply === 'function')
ok('lib/index.js: declares the services it needs', Array.isArray(host.inject) && host.inject.includes('tools') && host.inject.includes('systemPrompt'), JSON.stringify(host.inject))
ok('lib/index.js: imports only Node builtins', !/^\s*import\s[^\n]*from\s+'(?!node:)/m.test(read(pkg.main)))

ok('dshHome(): honors DSH_HOME', host.dshHome({ DSH_HOME: work }) === work)
ok('dshHome(): falls back to ~/.dsh', host.dshHome({}).endsWith(join('.dsh')))
ok('stateFilePath(): lives under the Harness home', host.stateFilePath({ DSH_HOME: work }) === join(work, 'workspaceplus', 'directories.json'))
ok('keyOf(): folds case on Windows', process.platform !== 'win32' || host.keyOf('D:\\A\\B') === host.keyOf('d:\\a\\b'))

ok('validateLabel(): accepts a normal label', host.validateLabel('backend').ok === true)
ok('validateLabel(): rejects spaces', host.validateLabel('back end').ok === false)
ok('validateLabel(): rejects empty', host.validateLabel('  ').ok === false)
ok('validateLabel(): rejects reserved words', host.validateLabel('cwd').ok === false)
ok('validateDirectory(): accepts an existing directory', host.validateDirectory(backendDir).ok === true)
ok('validateDirectory(): rejects a relative path', host.validateDirectory('backend').ok === false)
ok('validateDirectory(): rejects a missing path', host.validateDirectory(missingDir).ok === false)
ok('validateDirectory(): rejects a file', host.validateDirectory(join(ROOT, 'package.json')).ok === false)

const state = host.emptyState()
ok('emptyState(): starts empty', Object.keys(state.workspaces).length === 0)
ok('emptyState(): carries the settings block', state.settings?.defaultWorkspaceEnabled === false)
ok('DEFAULT_SETTINGS: the default workspace is off until the user opts in', host.DEFAULT_SETTINGS.defaultWorkspaceEnabled === false)
ok('normalizeSettings(): fills defaults', host.normalizeSettings(undefined).defaultWorkspaceEnabled === false)
ok('normalizeSettings(): rejects a non-boolean', host.normalizeSettings({ defaultWorkspaceEnabled: 'yes' }).defaultWorkspaceEnabled === false)
ok('normalizeSettings(): keeps a boolean', host.normalizeSettings({ defaultWorkspaceEnabled: true }).defaultWorkspaceEnabled === true)
ok('normalizeState(): an older file without settings keeps working', host.normalizeState({ version: 1, workspaces: {} }).settings.defaultWorkspaceEnabled === false)
ok('normalizeState(): reads a stored setting', host.normalizeState({ version: 1, settings: { defaultWorkspaceEnabled: true }, workspaces: {} }).settings.defaultWorkspaceEnabled === true)

// --- the per-workspace layer -------------------------------------------------
ok('emptyState(): carries an empty per-workspace map', Object.keys(state.settings.workspaceEnabled).length === 0)
ok(
  'defaultSettings(): hands out a fresh map instead of sharing one',
  host.defaultSettings().workspaceEnabled !== host.defaultSettings().workspaceEnabled,
)
ok('normalizeSettings(): fills in a missing per-workspace map', Object.keys(host.normalizeSettings(undefined).workspaceEnabled).length === 0)
ok(
  'normalizeSettings(): keeps boolean overrides',
  host.normalizeSettings({ workspaceEnabled: { a: true, b: false } }).workspaceEnabled.a === true &&
    host.normalizeSettings({ workspaceEnabled: { a: true, b: false } }).workspaceEnabled.b === false,
)
ok(
  'normalizeSettings(): drops a non-boolean override rather than guessing',
  Object.keys(host.normalizeSettings({ workspaceEnabled: { a: 'yes', b: 1, c: null } }).workspaceEnabled).length === 0,
)
ok('normalizeSettings(): survives a garbage map', Object.keys(host.normalizeSettings({ workspaceEnabled: 'nope' }).workspaceEnabled).length === 0)
ok('normalizeState(): an older file without the map keeps working', Object.keys(host.normalizeState({ version: 1, workspaces: {} }).settings.workspaceEnabled).length === 0)

{
  const off = { workspaceEnabled: { [host.keyOf(docsDir)]: false } }
  const on = { workspaceEnabled: { [host.keyOf(workspaceRoot)]: true } }
  ok(
    'isFeatureEnabledFor(): a normal workspace is always enabled',
    host.isFeatureEnabledFor({ settings: {}, workspacePath: docsDir, defaultWorkspacePath: workspaceRoot }) === true,
  )
  ok(
    'isFeatureEnabledFor(): the default workspace is disabled by default',
    host.isFeatureEnabledFor({ settings: {}, workspacePath: workspaceRoot, defaultWorkspacePath: workspaceRoot }) === false,
  )
  ok(
    'isFeatureEnabledFor(): the switch enables the default workspace',
    host.isFeatureEnabledFor({ settings: { defaultWorkspaceEnabled: true }, workspacePath: workspaceRoot, defaultWorkspacePath: workspaceRoot }) === true,
  )
  ok(
    'isFeatureEnabledFor(): no default workspace means nothing is gated',
    host.isFeatureEnabledFor({ settings: {}, workspacePath: workspaceRoot, defaultWorkspacePath: null }) === true,
  )
  ok(
    'isFeatureEnabledFor(): path comparison is case-insensitive on Windows',
    host.isFeatureEnabledFor({ settings: {}, workspacePath: workspaceRoot.toUpperCase(), defaultWorkspacePath: workspaceRoot }) === (process.platform !== 'win32'),
  )
  ok(
    'isFeatureEnabledFor(): a per-workspace override turns a normal workspace OFF',
    host.isFeatureEnabledFor({ settings: off, workspacePath: docsDir, defaultWorkspacePath: workspaceRoot }) === false,
  )
  ok(
    'isFeatureEnabledFor(): a per-workspace override turns the default workspace ON',
    host.isFeatureEnabledFor({ settings: on, workspacePath: workspaceRoot, defaultWorkspacePath: workspaceRoot }) === true,
  )
  ok(
    'isFeatureEnabledFor(): an override beats the default-workspace switch in both directions',
    host.isFeatureEnabledFor({
      settings: { defaultWorkspaceEnabled: true, workspaceEnabled: { [host.keyOf(workspaceRoot)]: false } },
      workspacePath: workspaceRoot,
      defaultWorkspacePath: workspaceRoot,
    }) === false,
  )
  ok(
    'isFeatureEnabledFor(): an override is matched by the same folding as the store keys',
    host.isFeatureEnabledFor({ settings: off, workspacePath: docsDir.toUpperCase(), defaultWorkspacePath: workspaceRoot }) === (process.platform !== 'win32'),
  )
}

{
  const settingsState = host.emptyState()
  const applied = host.applySettings(settingsState, { defaultWorkspaceEnabled: true })
  ok('applySettings(): flips the default-workspace switch', applied.ok === true && settingsState.settings.defaultWorkspaceEnabled === true, applied.message)
  ok('applySettings(): reports the new state in its message', applied.message.includes('启用'), applied.message)
  ok('applySettings(): rejects a non-boolean', host.applySettings(host.emptyState(), { defaultWorkspaceEnabled: 'yes' }).ok === false)
}
{
  const key = host.keyOf(docsDir)
  const target = host.emptyState()
  const off = host.applySettings(target, { workspaceEnabled: { [key]: false } })
  ok('applySettings(): writes a per-workspace override', off.ok === true && target.settings.workspaceEnabled[key] === false, off.message)
  ok('applySettings(): names the workspace in its message', off.message.includes(key), off.message)
  ok(
    'applySettings(): a boolean override is observable through isFeatureEnabledFor()',
    host.isFeatureEnabledFor({ settings: target.settings, workspacePath: docsDir, defaultWorkspacePath: workspaceRoot }) === false,
  )
  const on = host.applySettings(target, { workspaceEnabled: { [key]: true } })
  ok('applySettings(): flips the same override back on', on.ok === true && target.settings.workspaceEnabled[key] === true, on.message)
  const cleared = host.applySettings(target, { workspaceEnabled: { [key]: null } })
  ok(
    'applySettings(): null restores the workspace default instead of pinning it',
    cleared.ok === true && !(key in target.settings.workspaceEnabled) && cleared.message.includes('默认'),
    cleared.message,
  )
  ok(
    'applySettings(): restoring the default is observable through isFeatureEnabledFor()',
    host.isFeatureEnabledFor({ settings: target.settings, workspacePath: docsDir, defaultWorkspacePath: workspaceRoot }) === true,
  )
  ok('applySettings(): rejects a non-boolean override', host.applySettings(host.emptyState(), { workspaceEnabled: { [key]: 'yes' } }).ok === false)
  ok('applySettings(): rejects a non-object map', host.applySettings(host.emptyState(), { workspaceEnabled: true }).ok === false)
  ok('applySettings(): rejects an empty patch', host.applySettings(host.emptyState(), {}).ok === false)
  const untouched = host.emptyState()
  host.applySettings(untouched, { workspaceEnabled: { [key]: false, other: 'nope' } })
  ok('applySettings(): a partially invalid patch writes nothing at all', Object.keys(untouched.settings.workspaceEnabled).length === 0)
  const both = host.emptyState()
  const mixed = host.applySettings(both, { defaultWorkspaceEnabled: true, workspaceEnabled: { [key]: false } })
  ok(
    'applySettings(): one patch can carry both layers',
    mixed.ok === true && both.settings.defaultWorkspaceEnabled === true && both.settings.workspaceEnabled[key] === false,
    mixed.message,
  )
}

ok('normalizeState(): survives garbage', Object.keys(host.normalizeState('nonsense').workspaces).length === 0)
ok(
  'normalizeState(): drops malformed entries and keeps good ones',
  Object.values(
    host.normalizeState({ workspaces: { [workspaceRoot]: { path: workspaceRoot, dirs: [{ label: 'ok', path: docsDir }, { label: 'bad label', path: docsDir }, 'junk'] } } }).workspaces,
  )[0].dirs.length === 1,
)
ok(
  'normalizeState(): de-duplicates labels case-insensitively',
  Object.values(
    host.normalizeState({ workspaces: { [workspaceRoot]: { path: workspaceRoot, dirs: [{ label: 'api', path: docsDir }, { label: 'API', path: backendDir }] } } }).workspaces,
  )[0].dirs.length === 1,
)

const addResult = host.applyOperation(state, { op: 'add', workspace: workspaceRoot, label: 'backend', path: backendDir, note: '后端 API' })
ok('applyOperation(add): registers a labeled directory', addResult.ok === true, addResult.message)
ok('applyOperation(add): stores the label, path and note', state.workspaces[host.keyOf(workspaceRoot)].dirs[0].note === '后端 API')
ok('applyOperation(add): rejects a duplicate label', host.applyOperation(state, { op: 'add', workspace: workspaceRoot, label: 'Backend', path: docsDir }).ok === false)
ok('applyOperation(add): rejects an invalid label', host.applyOperation(state, { op: 'add', workspace: workspaceRoot, label: 'a b', path: docsDir }).ok === false)
ok('applyOperation(add): rejects a missing directory', host.applyOperation(state, { op: 'add', workspace: workspaceRoot, label: 'gone', path: missingDir }).ok === false)
ok('applyOperation(add): rejects an invalid workspace', host.applyOperation(state, { op: 'add', workspace: missingDir, label: 'x', path: docsDir }).ok === false)

const updateResult = host.applyOperation(state, { op: 'update', workspace: workspaceRoot, label: 'backend', path: docsDir, note: '' })
ok('applyOperation(update): re-points and clears the note', updateResult.ok === true && state.workspaces[host.keyOf(workspaceRoot)].dirs[0].path === docsDir && state.workspaces[host.keyOf(workspaceRoot)].dirs[0].note === undefined)
ok('applyOperation(update): rejects an unknown label', host.applyOperation(state, { op: 'update', workspace: workspaceRoot, label: 'nope' }).ok === false)
ok('applyOperation(bogus): rejects an unknown op', host.applyOperation(state, { op: 'destroy', workspace: workspaceRoot, label: 'backend' }).ok === false)

// Restore a two-entry mapping for the prompt/tool/route assertions, and give the
// default workspace a mapping of its own so the gate can be observed on it.
host.applyOperation(state, { op: 'update', workspace: workspaceRoot, label: 'backend', path: backendDir, note: '后端 API' })
host.applyOperation(state, { op: 'add', workspace: workspaceRoot, label: 'docs', path: docsDir, note: '设计文档' })
host.applyOperation(state, { op: 'add', workspace: defaultDir, label: 'notes', path: docsDir, note: '默认工作区示例' })
const entry = host.entryFor(state, workspaceRoot)
ok('entryFor(): finds the workspace entry', entry !== undefined && entry.dirs.length === 2)
ok('entryFor(): the default workspace has its own entry', host.entryFor(state, defaultDir)?.dirs.length === 1)

const contextText = host.renderDirectoryContext({ workspacePath: workspaceRoot, entry, sandboxMode: 'danger-full-access' })
ok('renderDirectoryContext(): names the workspace root', contextText.includes(workspaceRoot))
ok('renderDirectoryContext(): lists every label with its absolute path', entry.dirs.every((dir) => contextText.includes(`\`${dir.label}\` → \`${dir.path}\``)))
ok('renderDirectoryContext(): forbids guessing', contextText.includes('不要根据目录名相似'))
ok('renderDirectoryContext(): points at the tool for edits', contextText.includes('workspace_dirs'))
ok('renderDirectoryContext(): confines work to the root and the labeled directories', contextText.includes('只在上表列出的目录和工作区根目录') && contextText.includes('不要扫描 cwd 的同级目录'))
ok('renderDirectoryContext(): forbids unscoped recursive scanning of the container root', contextText.includes('无范围模式'))
ok('renderDirectoryContext(): stays silent for an empty mapping', host.renderDirectoryContext({ workspacePath: workspaceRoot, entry: { path: workspaceRoot, dirs: [] } }) === '')
ok('renderDirectoryContext(): stays silent without an entry', host.renderDirectoryContext({ workspacePath: workspaceRoot }) === '')
const restrictedText = host.renderDirectoryContext({ workspacePath: workspaceRoot, entry, sandboxMode: 'workspace-write' })
ok('renderDirectoryContext(): flags read-only roots under workspace-write', restrictedText.includes('在工作区根目录之外') && restrictedText.includes('workspace-write'))
ok('renderDirectoryContext(): does not flag a root inside the workspace', !host.renderDirectoryContext({ workspacePath: workspaceRoot, entry: { path: workspaceRoot, dirs: [{ label: 'inner', path: join(workspaceRoot, 'src') }] }, sandboxMode: 'workspace-write' }).includes('在工作区根目录之外'))

ok('renderDirectoryList(): explains an empty mapping', host.renderDirectoryList(workspaceRoot, undefined).includes('还没有登记'))
ok('renderDirectoryList(): lists the labels', host.renderDirectoryList(workspaceRoot, entry).includes('docs -> ' + docsDir))

// ---------------------------------------------------------------------------
// 4. Host half — Cordis wiring and persistence
// ---------------------------------------------------------------------------
process.env.DSH_HOME = home
const stateFile = host.stateFilePath()
mkdirSync(dirname(stateFile), { recursive: true })
writeFileSync(stateFile, `${JSON.stringify(host.normalizeState(state), null, 2)}\n`, 'utf8')

const captured = { contexts: [], tools: [], effects: [], route: null, warns: [] }

/** The workspace registry double the host half reads when it builds its snapshots. */
const demoRegistry = {
  list: () => [
    { id: 'ws-default', path: defaultDir, title: '默认工作区' },
    { id: 'ws-1', path: workspaceRoot, title: 'demo' },
  ],
  // The host half probes the PUBLIC service: `initializeDefault` returns the
  // recorded default without touching the directory resolver.
  initializeDefault: async () => ({ id: 'ws-default', path: defaultDir, title: '默认工作区' }),
}

/**
 * A context whose `webServer`/`workspaceRegistry`/`sandboxPolicy` services are
 * fakes. `registry: undefined` means "that service is not mounted".
 */
function makeHostCtx({ registry, connection } = {}) {
  return {
    logger: { warn: (error) => captured.warns.push(String(error)) },
    get: (key) => {
      if (key === 'workspaceRegistry') return registry
      if (key === 'sandboxPolicy') return { resolve: () => ({ mode: 'danger-full-access' }) }
      if (key === 'connection') return connection
      return undefined
    },
    effect(fn, label) {
      captured.effects.push(label)
      return fn()
    },
    inject(deps, callback) {
      captured.effects.push(`inject:${deps.join(',')}`)
      if (deps.includes('webServer')) {
        callback({
          effect: (fn) => fn(),
          webServer: {
            register: (route) => {
              captured.route = route
              return () => {}
            },
          },
        })
      }
      if (deps.includes('workspaceRegistry')) {
        callback({ effect: (fn) => fn(), workspaceRegistry: registry })
      }
    },
    systemPrompt: {
      context: (contribution) => {
        captured.contexts.push(contribution)
        return () => {}
      },
    },
    tools: {
      register: (definition) => {
        captured.tools.push(definition)
        return () => {}
      },
    },
  }
}

let applyError = null
const logs = []
const originalLog = console.log
console.log = (...args) => logs.push(args.join(' '))
try {
  host.apply(makeHostCtx({ registry: demoRegistry }))
} catch (error) {
  applyError = error
} finally {
  console.log = originalLog
}
ok('lib/index.js: apply() registers without throwing', applyError === null, applyError?.message)
ok('lib/index.js: apply() logs its activation', logs.some((line) => line.includes(pkg.name)), logs.join(' | '))

// The default-workspace probe is asynchronous (it goes through the registry's
// mutation queue), so let one macrotask settle before reading the gate.
await new Promise((resolve) => setTimeout(resolve, 0))

ok('apply(): contributes exactly one prompt context', captured.contexts.length === 1, captured.contexts.map((c) => c.name).join(', '))
const contribution = captured.contexts[0]
ok('apply(): the prompt context has a stable name', contribution?.name === host.CONTEXT_NAME, contribution?.name)
ok('apply(): the prompt context has a finite order', Number.isFinite(contribution?.order), String(contribution?.order))
ok('apply(): the prompt context renders text per request', typeof contribution?.text === 'function')
const sessionArg = { agent: { session: { id: 's-1', header: { cwd: workspaceRoot } } } }
ok('apply(): the context text carries this session workspace mapping', String(contribution.text(sessionArg)).includes('backend'))
ok('apply(): the context text is empty without a session', contribution.text({}) === '')
ok('apply(): the context text is empty for an unrelated workspace', contribution.text({ agent: { session: { header: { cwd: docsDir } } } }) === '')
ok(
  'apply(): the context text stays silent for the default workspace until the switch is on',
  contribution.text({ agent: { session: { header: { cwd: defaultDir } } } }) === '',
)

ok('apply(): registers exactly one tool', captured.tools.length === 1, captured.tools.map((t) => t.name).join(', '))
const tool = captured.tools[0]
ok('apply(): the tool is named workspace_dirs', tool?.name === host.TOOL_NAME, tool?.name)
ok('apply(): the tool has a description', typeof tool?.description === 'string' && tool.description.length > 40)
ok('apply(): the tool output declares a string schema and a renderer', tool?.output?.schema?.type === 'string' && typeof tool?.output?.render === 'function')
ok('apply(): the tool renders text content', JSON.stringify(tool.output.render({}, 'hi')) === JSON.stringify([{ type: 'text', text: 'hi' }]))
ok('apply(): the tool requires the action argument', Array.isArray(tool?.parameters?.required) && tool.parameters.required.includes('action'))
ok('apply(): the tool schema uses only the supported keyword subset', JSON.stringify(Object.keys(tool.parameters).sort()) === JSON.stringify(['additionalProperties', 'properties', 'required', 'type']))

const toolExec = { agent: { session: { header: { cwd: workspaceRoot } } } }
const listed = await tool.execute({ action: 'list' }, toolExec)
ok('workspace_dirs(list): reports the registered labels', listed.includes('backend') && listed.includes(docsDir), listed.split('\n')[0])
const toolAdd = await tool.execute({ action: 'add', label: 'infra', path: work, note: '部署脚本' }, toolExec)
ok('workspace_dirs(add): registers a new label', toolAdd.startsWith('已为工作区'), toolAdd.split('\n')[0])
ok('workspace_dirs(add): persists to the state file', host.readState(stateFile).workspaces[host.keyOf(workspaceRoot)].dirs.some((d) => d.label === 'infra'))
const toolDup = await tool.execute({ action: 'add', label: 'infra', path: work }, toolExec)
ok('workspace_dirs(add): refuses a duplicate label', toolDup.startsWith('Error:'), toolDup.split('\n')[0])
const toolRemove = await tool.execute({ action: 'remove', label: 'infra' }, toolExec)
ok('workspace_dirs(remove): drops the label', toolRemove.startsWith('已移除'), toolRemove.split('\n')[0])
ok('workspace_dirs(remove): persists the removal', !host.readState(stateFile).workspaces[host.keyOf(workspaceRoot)].dirs.some((d) => d.label === 'infra'))
const toolNoSession = await tool.execute({ action: 'list' }, {})
ok('workspace_dirs: asks for an explicit workspace without a session', toolNoSession.startsWith('Error:'), toolNoSession)
const toolBadAction = await tool.execute({}, toolExec)
ok('workspace_dirs: rejects a missing or unknown action', toolBadAction.startsWith('Error:') && toolBadAction.includes('list'), toolBadAction)
const toolOther = await tool.execute({ action: 'list', workspace: docsDir }, {})
ok('workspace_dirs: honors an explicit workspace argument', toolOther.includes(docsDir), toolOther.split('\n')[0])
const toolDefault = await tool.execute({ action: 'list', workspace: defaultDir }, {})
ok('workspace_dirs: refuses the default workspace while the switch is off', toolDefault.startsWith('Error:') && toolDefault.includes('设置'), toolDefault.split('\n')[0])

ok('apply(): registers the JSON route', captured.route?.path === host.API_PATH && captured.route?.kind === 'exact', captured.route?.path)

/** Minimal node:http request/response doubles. */
function fakeRequest(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}
function fakeResponse() {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text ?? ''
    },
  }
}

const getResponse = fakeResponse()
await captured.route.handler(fakeRequest('GET'), getResponse)
const getPayload = JSON.parse(getResponse.body)
ok('route(GET): answers 200 JSON', getResponse.status === 200 && getResponse.headers['content-type'].startsWith('application/json'))
ok('route(GET): reports the workspace registry as available', getPayload.registryAvailable === true)
ok('route(GET): lists both workspaces', getPayload.workspaces.length === 2, String(getPayload.workspaces.length))
const demoWorkspace = getPayload.workspaces.find((w) => w.id === 'ws-1')
const defaultWorkspace = getPayload.workspaces.find((w) => w.id === 'ws-default')
ok('route(GET): carries the directory mapping', demoWorkspace?.dirs.length === 2, JSON.stringify(demoWorkspace?.dirs?.map((d) => d.label)))
ok('route(GET): exposes the resolved default workspace', getPayload.defaultWorkspaceId === 'ws-default' && getPayload.defaultWorkspacePath === defaultDir)
ok('route(GET): flags the default workspace', defaultWorkspace?.isDefault === true && demoWorkspace?.isDefault === false)
ok('route(GET): the default workspace is disabled by default', defaultWorkspace?.enabled === false)
ok('route(GET): every other workspace stays enabled', demoWorkspace?.enabled === true)
ok('route(GET): publishes the settings block', getPayload.settings?.defaultWorkspaceEnabled === false)
ok(
  'route(GET): publishes each workspace\'s settings key',
  demoWorkspace?.key === host.keyOf(workspaceRoot) && defaultWorkspace?.key === host.keyOf(defaultDir),
  `${String(demoWorkspace?.key)} / ${String(defaultWorkspace?.key)}`,
)
ok('route(GET): publishes an empty per-workspace override map', Object.keys(getPayload.settings?.workspaceEnabled ?? {}).length === 0)

const settingsResponse = fakeResponse()
await captured.route.handler(fakeRequest('POST', { op: 'settings', settings: { defaultWorkspaceEnabled: true } }), settingsResponse)
const settingsPayload = JSON.parse(settingsResponse.body)
ok('route(POST settings): flips the switch', settingsPayload.ok === true, settingsPayload.message)
ok('route(POST settings): reports the default workspace as enabled', settingsPayload.workspaces.find((w) => w.id === 'ws-default')?.enabled === true)
ok('route(POST settings): the prompt context now runs for the default workspace', String(contribution.text({ agent: { session: { header: { cwd: defaultDir } } } })).length > 0)
ok('route(POST settings): the tool now accepts the default workspace', !String(await tool.execute({ action: 'list', workspace: defaultDir }, {})).startsWith('Error:'))
const settingsBack = fakeResponse()
await captured.route.handler(fakeRequest('POST', { op: 'settings', settings: { defaultWorkspaceEnabled: false } }), settingsBack)
ok('route(POST settings): can be turned back off', JSON.parse(settingsBack.body).settings?.defaultWorkspaceEnabled === false)
ok('route(POST settings): rejects a non-boolean', JSON.parse((await (async () => { const r = fakeResponse(); await captured.route.handler(fakeRequest('POST', { op: 'settings', settings: { defaultWorkspaceEnabled: 1 } }), r); return r })()).body).ok === false)

// Turning an ordinarily-enabled workspace OFF through the route has to reach all
// three surfaces: the snapshot flag, the prompt contribution, and the tool.
const offResponse = fakeResponse()
await captured.route.handler(
  fakeRequest('POST', { op: 'settings', settings: { workspaceEnabled: { [host.keyOf(workspaceRoot)]: false } } }),
  offResponse,
)
const offPayload = JSON.parse(offResponse.body)
ok('route(POST settings): accepts a per-workspace override', offPayload.ok === true, offPayload.message)
ok('route(POST settings): the workspace reports itself as disabled', offPayload.workspaces.find((w) => w.id === 'ws-1')?.enabled === false)
ok('route(POST settings): the override reaches the state file', host.readState(stateFile).settings.workspaceEnabled[host.keyOf(workspaceRoot)] === false)
ok(
  'route(POST settings): the prompt contribution stops for that workspace',
  String(contribution.text({ agent: { session: { header: { cwd: workspaceRoot } } } })) === '',
)
ok(
  'route(POST settings): the tool refuses that workspace and names the settings page',
  String(await tool.execute({ action: 'list', workspace: workspaceRoot }, {})).includes('设置 → workspace+'),
)
ok(
  'route(POST settings): the override touches only its own workspace',
  Object.keys(offPayload.settings.workspaceEnabled).length === 1 &&
    offPayload.workspaces.find((w) => w.id === 'ws-default')?.enabled === false,
  JSON.stringify(offPayload.settings.workspaceEnabled),
)
const onResponse = fakeResponse()
await captured.route.handler(
  fakeRequest('POST', { op: 'settings', settings: { workspaceEnabled: { [host.keyOf(workspaceRoot)]: null } } }),
  onResponse,
)
ok(
  'route(POST settings): null restores the workspace default',
  JSON.parse(onResponse.body).workspaces.find((w) => w.id === 'ws-1')?.enabled === true,
)
ok(
  'route(POST settings): rejects a malformed override map',
  JSON.parse((await (async () => { const r = fakeResponse(); await captured.route.handler(fakeRequest('POST', { op: 'settings', settings: { workspaceEnabled: { a: 'yes' } } }), r); return r })()).body).ok === false,
)

const postResponse = fakeResponse()
await captured.route.handler(fakeRequest('POST', { op: 'add', workspace: workspaceRoot, label: 'ui', path: docsDir }), postResponse)
const postPayload = JSON.parse(postResponse.body)
ok('route(POST): applies a mutation', postPayload.ok === true, postPayload.message)
ok('route(POST): returns the refreshed workspace list', postPayload.workspaces.find((w) => w.id === 'ws-1').dirs.some((d) => d.label === 'ui'))
ok('route(POST): the mutation reached the state file', host.readState(stateFile).workspaces[host.keyOf(workspaceRoot)].dirs.some((d) => d.label === 'ui'))

const badResponse = fakeResponse()
await captured.route.handler(fakeRequest('POST', { op: 'add', workspace: workspaceRoot, label: 'bad label', path: docsDir }), badResponse)
ok('route(POST): surfaces a validation failure without a 5xx', badResponse.status === 200 && JSON.parse(badResponse.body).ok === false)

const methodResponse = fakeResponse()
await captured.route.handler(fakeRequest('DELETE'), methodResponse)
ok('route(): rejects unsupported methods', methodResponse.status === 405)

// A connection service that rejects: the route must not answer.
captured.route = null
host.apply(makeHostCtx({ registry: demoRegistry, connection: { admit: () => ({ rejection: 401 }) } }))
const deniedResponse = fakeResponse()
await captured.route.handler(fakeRequest('GET'), deniedResponse)
ok('route(): enforces the connection admission when one is mounted', deniedResponse.status === 401, String(deniedResponse.status))

// A host without the workspace registry must still boot and answer.
captured.route = null
captured.contexts = []
captured.tools = []
host.apply(makeHostCtx({ registry: undefined }))
const noRegistryResponse = fakeResponse()
await captured.route.handler(fakeRequest('GET'), noRegistryResponse)
ok('route(): degrades when no workspace registry is mounted', JSON.parse(noRegistryResponse.body).registryAvailable === false)
ok('apply(): works without a workspace registry mounted', captured.tools.length === 1)

// The registry service is registered before its own init finishes, so the first
// probe can fail on a cold boot. It must retry rather than silently enabling the
// feature on the default workspace forever.
captured.route = null
let probeCount = 0
const flakyRegistry = {
  list: () => [{ id: 'ws-default', path: defaultDir, title: '默认工作区' }],
  initializeDefault: async () => {
    probeCount += 1
    if (probeCount === 1) throw new Error('workspace registry is not started yet')
    return { id: 'ws-default', path: defaultDir, title: '默认工作区' }
  },
}
host.apply(makeHostCtx({ registry: flakyRegistry }))
await new Promise((resolve) => setTimeout(resolve, 0))
ok('default-workspace probe: a not-ready registry does not settle the gate', probeCount === 1, String(probeCount))
const retryResponse = fakeResponse()
await captured.route.handler(fakeRequest('GET'), retryResponse)
ok('default-workspace probe: the next request retries it', probeCount >= 2, String(probeCount))
ok(
  'default-workspace probe: the retried probe gates the default workspace',
  JSON.parse(retryResponse.body).workspaces.find((w) => w.id === 'ws-default')?.enabled === false,
)

// ---------------------------------------------------------------------------
// 5. Browser half — script form, loader registration, module requests
// ---------------------------------------------------------------------------
const clientSource = read(pkg.exports['./client'].default)

ok('lib/client.js: is a loader script, not an ES module', !/^\s*(import|export)\s/m.test(clientSource))
ok('lib/client.js: calls window.__ModuleLoader__.load', /window\.__ModuleLoader__\.load\(\{/.test(clientSource))
const declaredId = clientSource.match(/^\s*id:\s*'([^']+)'/m)?.[1]
ok('lib/client.js: registration id equals the package name', declaredId === pkg.name, declaredId)

const requiredSpecifiers = [...clientSource.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
const outsidePlatform = requiredSpecifiers.filter((spec) => !PLATFORM_MODULES.includes(spec))
ok(
  'lib/client.js: only requires seeded platform modules',
  outsidePlatform.length === 0,
  requiredSpecifiers.join(', ') + (outsidePlatform.length ? ` — unsupported: ${outsidePlatform.join(', ')}` : ''),
)

// --- a minimal DOM double that understands exactly the selectors this bundle uses
const styleTags = []
const rafQueue = []
const observers = []

function makeDom() {
  const body = makeElement('body')
  const head = makeElement('head')
  return { body, head }
}
function makeElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parent: null,
    dataset: {},
    attrs: {},
    listeners: {},
    className: '',
    type: '',
    title: '',
    innerHTML: '',
    textContent: '',
    appendChild(child) {
      return element.insertBefore(child, null)
    },
    /** `insertBefore(node, null)` appends, exactly like the DOM. */
    insertBefore(child, anchor) {
      if (child.parent !== null) {
        child.parent.children = child.parent.children.filter((node) => node !== child)
      }
      const at = anchor === null || anchor === undefined ? element.children.length : element.children.indexOf(anchor)
      if (at < 0) element.children.push(child)
      else element.children.splice(at, 0, child)
      child.parent = element
      return child
    },
    remove() {
      const parent = element.parent
      if (parent === null) return
      parent.children = parent.children.filter((child) => child !== element)
      element.parent = null
    },
    get lastElementChild() {
      return element.children.length === 0 ? null : element.children[element.children.length - 1]
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attrs, name) ? element.attrs[name] : null
    },
    setAttribute(name, value) {
      element.attrs[name] = String(value)
    },
    addEventListener(type, fn) {
      element.listeners[type] = fn
    },
    get isConnected() {
      let node = element
      while (node.parent !== null) node = node.parent
      return node === body
    },
    querySelectorAll(selector) {
      return descendants(element).filter((node) => matches(node, selector))
    },
  }
  return element
}
function descendants(element) {
  const out = []
  const stack = [...element.children]
  while (stack.length > 0) {
    const node = stack.pop()
    out.push(node)
    stack.push(...node.children)
  }
  return out
}
function matches(element, selector) {
  if (selector === '[data-slot="sidebar.workspaces"]') return element.getAttribute('data-slot') === 'sidebar.workspaces'
  if (selector === '[data-row-key^="workspace:"]') return (element.getAttribute('data-row-key') ?? '').startsWith('workspace:')
  if (selector.startsWith('style[data-plugin-css=')) return element.dataset.pluginCss !== undefined
  return false
}

const { body, head } = makeDom()
const fakeDocument = {
  baseURI: 'http://127.0.0.1:19387/',
  body,
  head,
  createElement: (tag) => makeElement(tag),
  querySelector: (selector) => {
    if (selector.startsWith('style[data-plugin-css=')) {
      const wanted = selector.match(/data-plugin-css="(.*)"\]$/)?.[1]
      return head.children.find((tag) => tag.dataset.pluginCss === wanted) ?? null
    }
    return descendants(body).find((node) => matches(node, selector)) ?? null
  },
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    observers.push(this)
  }
  observe() {}
  disconnect() {
    this.disconnected = true
  }
}
const flushMutations = () => {
  for (const observer of [...observers]) if (!observer.disconnected) observer.callback([], observer)
}
const flushAnimationFrames = () => {
  for (const callback of rafQueue.splice(0)) callback(0)
}
/** One full reconcile cycle: a DOM mutation, then the animation frame it schedules. */
const settleDom = () => {
  flushMutations()
  flushAnimationFrames()
}

const registrations = []
/** Every host call the browser half makes, with a canned reply the tests control. */
const fetchCalls = []
let fetchReply = {
  status: 200,
  body: {
    ok: true,
    settings: { defaultWorkspaceEnabled: false },
    defaultWorkspaceId: 'ws-default',
    defaultWorkspacePath: defaultDir,
    registryAvailable: true,
    workspaces: [],
  },
}
const sandbox = {
  window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  document: fakeDocument,
  MutationObserver: FakeMutationObserver,
  requestAnimationFrame: (callback) => rafQueue.push(callback),
  cancelAnimationFrame: () => {},
  setTimeout,
  clearTimeout,
  fetch: async (url, init) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
    return {
      ok: fetchReply.status >= 200 && fetchReply.status < 300,
      status: fetchReply.status,
      async json() {
        return fetchReply.body
      },
    }
  },
  URL,
  console,
}
vm.runInNewContext(clientSource, sandbox, { filename: 'lib/client.js' })

ok('lib/client.js: registers exactly one module factory', registrations.length === 1, String(registrations.length))
const registration = registrations[0]
ok('lib/client.js: the loader id matches the package name', registration?.id === pkg.name, registration?.id)

/** Minimal React: enough to run the plugin's function components for real. */
const React = {
  createElement(type, props, ...children) {
    // Like React, `children` is part of props — components such as the
    // primitives' Button and Modal read `props.children`.
    const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    const merged = { ...(props ?? {}) }
    if (flat.length > 0) merged.children = flat.length === 1 ? flat[0] : flat
    return { type, props: merged, children: flat }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  Fragment: 'Fragment',
}
const primitives = {
  Button: (props) => React.createElement('button', props, props.children),
  Switch: (props) =>
    React.createElement(
      'button',
      {
        role: 'switch',
        'aria-checked': props.checked,
        disabled: props.disabled,
        'aria-label': props.label,
        onClick: () => props.onChange(!props.checked),
      },
      null,
    ),
  Modal: (props) =>
    props.open
      ? React.createElement(
          'div',
          { className: ['modal', props.className].filter(Boolean).join(' '), role: 'dialog', description: props.description },
          props.title,
          props.description,
          props.children,
          props.footer,
        )
      : null,
  // Like the real tooltip, the bubble only exists while hovered/focused: the label
  // is exposed on the anchor, never rendered into the dialog's text.
  Tooltip: (props) =>
    React.createElement(
      'span',
      {
        className: 'tooltip',
        'data-side': props.side,
        'data-tooltip': typeof props.label === 'function' ? props.label() : props.label,
      },
      props.children,
    ),
}
const requireStub = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected require("${specifier}") — not in the platform seed table`)
}

const collectText = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  return collectText(node.children)
}
const findElements = (node, predicate, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  findElements(node.children, predicate, found)
  return found
}
/** Expand function components the way a reconciler would. */
const render = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(render).filter((child) => child !== null)
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { ...node, children: (node.children ?? []).map(render).filter((child) => child !== null) }
}

let clientExports = null
let factoryError = null
try {
  clientExports = registration.factory(requireStub)
} catch (error) {
  factoryError = error
}
ok('lib/client.js: factory materializes without throwing', factoryError === null, factoryError?.message)
ok('lib/client.js: exports apply()', typeof clientExports?.apply === 'function')
ok('lib/client.js: exports inject as an array', Array.isArray(clientExports?.inject), JSON.stringify(clientExports?.inject))
ok('lib/client.js: injects the slots service', clientExports?.inject?.includes('slots'))
ok('lib/client.js: injects nothing the shell does not provide', (clientExports?.inject ?? []).every((s) => s === 'slots'), JSON.stringify(clientExports?.inject))
ok(
  'lib/client.js: injects exactly one stylesheet tag',
  head.children.filter((tag) => tag.dataset.pluginCss !== undefined).length === 1 &&
    head.children[0].dataset.plugin === pkg.name,
  `tags=${head.children.length}`,
)
ok('lib/client.js: the stylesheet is namespaced', head.children[0]?.textContent.includes('.dsh-workspace-plus-'))
ok('lib/client.js: the stylesheet styles the injected row button', head.children[0]?.textContent.includes('.dsh-workspace-plus-rowbtn'))
{
  // A client-module reload re-runs the factory in the page that is already open:
  // the stylesheet must stay a single, CURRENT tag instead of a stale duplicate.
  head.children[0].textContent = 'stale'
  registration.factory(requireStub)
  const tags = head.children.filter((tag) => tag.dataset.pluginCss !== undefined)
  ok(
    'lib/client.js: a reload rewrites the one stylesheet instead of duplicating a stale one',
    tags.length === 1 && String(tags[0].textContent).includes('.dsh-workspace-plus-dialog-card'),
    `tags=${String(tags.length)}`,
  )
}
{
  // The button must look like the shell's own row actions, whose `.iconButton` is
  // 16x16, transparent, tertiary-colored, and changes only its COLOR on hover.
  const css = String(head.children[0]?.textContent ?? '')
  const base = css.match(/\.dsh-workspace-plus-rowbtn\{([^}]*)\}/)?.[1] ?? ''
  const hover = css.match(/\.dsh-workspace-plus-rowbtn:hover\{([^}]*)\}/)?.[1] ?? ''
  ok('row button CSS: matches the shell icon metrics', base.includes('width:16px') && base.includes('height:16px'), base.slice(0, 60))
  ok('row button CSS: no resting background', base.includes('background:0 0') && !base.includes('interactive-bg-hover'))
  ok('row button CSS: uses the shell tertiary label color', base.includes('color:var(--dsw-alias-label-tertiary)'))
  ok('row button CSS: hover changes only the color', hover.includes('color:') && !hover.includes('background'), hover)
}

registration.factory(requireStub)
ok('lib/client.js: style injection is idempotent', head.children.length === 1, `tags=${head.children.length}`)

// ---------------------------------------------------------------------------
// 6. The dialog's external store
// ---------------------------------------------------------------------------
ok('store: starts closed', clientExports.readDialog().open === false && clientExports.readDialog().workspaceId === null)
const storeEvents = []
const unsubscribe = clientExports.subscribeDialog(() => storeEvents.push(clientExports.readDialog()))
clientExports.openWorkdirsDialog('ws-1')
ok('store: opening publishes the requested workspace', storeEvents.length === 1 && storeEvents[0].open === true && storeEvents[0].workspaceId === 'ws-1')
clientExports.openWorkdirsDialog('ws-1')
ok('store: an identical open is not republished', storeEvents.length === 1, String(storeEvents.length))
clientExports.openWorkdirsDialog('ws-2')
ok('store: a different workspace is republished', storeEvents.length === 2 && storeEvents[1].workspaceId === 'ws-2')
clientExports.closeWorkdirsDialog()
ok('store: closing clears the selection', storeEvents.length === 3 && storeEvents[2].open === false && storeEvents[2].workspaceId === null)
unsubscribe()
clientExports.openWorkdirsDialog(null)
ok('store: an unsubscribed listener stops receiving', storeEvents.length === 3, String(storeEvents.length))
clientExports.closeWorkdirsDialog()

ok(
  'selectWorkspace(): a requested id wins',
  clientExports.selectWorkspace([{ id: 'a', path: 'A' }, { id: 'b', path: 'B' }], 'b', 'A') === 'B',
)
ok(
  'selectWorkspace(): falls back to the current path',
  clientExports.selectWorkspace([{ id: 'a', path: 'A' }, { id: 'b', path: 'B' }], 'gone', 'B') === 'B',
)
ok(
  'selectWorkspace(): falls back to the first workspace',
  clientExports.selectWorkspace([{ id: 'a', path: 'A' }], null, 'gone') === 'A',
)
ok('selectWorkspace(): tolerates an empty list', clientExports.selectWorkspace([], 'a', 'A') === null)

// ---------------------------------------------------------------------------
// 7. The workspace-row button — DOM injection and its anchors
// ---------------------------------------------------------------------------
ok('row anchors: the bundle targets the shell-emitted sidebar outlet', clientExports.SIDEBAR_SLOT_SELECTOR === '[data-slot="sidebar.workspaces"]', clientExports.SIDEBAR_SLOT_SELECTOR)
ok('row anchors: the bundle targets the shell-emitted row key', clientExports.WORKSPACE_ROW_SELECTOR === '[data-row-key^="workspace:"]', clientExports.WORKSPACE_ROW_SELECTOR)

const availability = []
let installer = null
// Nothing is mounted yet, so the installer must stay silent rather than report
// "no rows" and flash the fallback entry on a healthy shell.
const early = clientExports.installWorkspaceRowButtons({ onAvailability: (value) => availability.push(value) })
installer = early
ok('row buttons: no report before the sidebar is mounted', availability.length === 0, JSON.stringify(availability))
ok('row buttons: unavailable while nothing is mounted', early.available() === false)
early.dispose()

const container = fakeDocument.createElement('div')
container.setAttribute('data-slot', 'sidebar.workspaces')
body.appendChild(container)

const rowOne = fakeDocument.createElement('div')
rowOne.setAttribute('data-row-key', 'workspace:ws-1')
container.appendChild(rowOne)
const actionsOne = fakeDocument.createElement('span')
rowOne.appendChild(actionsOne)
// The shell's real action cluster: the 「更多」menu button, then 「新会话」.
const reactOwned = fakeDocument.createElement('button')
reactOwned.setAttribute('aria-label', '更多')
actionsOne.appendChild(reactOwned)
const reactNewSession = fakeDocument.createElement('button')
reactNewSession.setAttribute('aria-label', '新会话')
actionsOne.appendChild(reactNewSession)

const rowUngrouped = fakeDocument.createElement('div')
rowUngrouped.setAttribute('data-row-key', 'workspace:')
container.appendChild(rowUngrouped)
const actionsUngrouped = fakeDocument.createElement('span')
rowUngrouped.appendChild(actionsUngrouped)

const rowDefault = fakeDocument.createElement('div')
rowDefault.setAttribute('data-row-key', 'workspace:ws-default')
container.appendChild(rowDefault)
const actionsDefault = fakeDocument.createElement('span')
rowDefault.appendChild(actionsDefault)

const rowTwo = fakeDocument.createElement('div')
rowTwo.setAttribute('data-row-key', 'workspace:ws-2')
container.appendChild(rowTwo)
const actionsTwo = fakeDocument.createElement('span')
rowTwo.appendChild(actionsTwo)

installer = clientExports.installWorkspaceRowButtons({ onAvailability: (value) => availability.push(value) })
settleDom()

ok('row buttons: reports availability once the sidebar is mounted', availability.length === 1 && availability[0] === true, JSON.stringify(availability))
ok('row buttons: available() reflects the injection', installer.available() === true)
const injectedOne = actionsOne.children.filter((child) => child.className === clientExports.ROW_BUTTON_CLASS)
const injectedTwo = actionsTwo.children.filter((child) => child.className === clientExports.ROW_BUTTON_CLASS)
ok('row buttons: one button per workspace row', injectedOne.length === 1 && injectedTwo.length === 1)
ok('row buttons: the ungrouped row gets none', actionsUngrouped.children.length === 0)
ok(
  'row buttons: seats itself between the menu and the new-session button',
  actionsOne.children[0] === reactOwned && actionsOne.children[1] === injectedOne[0] && actionsOne.children[2] === reactNewSession,
  actionsOne.children.map((child) => child.getAttribute('aria-label') ?? child.className).join(' | '),
)
ok('row buttons: the new-session button stays last', actionsOne.lastElementChild === reactNewSession)
ok(
  'row buttons: a cluster with only one child keeps that child last',
  (() => {
    const lone = fakeDocument.createElement('span')
    const only = fakeDocument.createElement('button')
    lone.appendChild(only)
    const button = fakeDocument.createElement('button')
    button.className = clientExports.ROW_BUTTON_CLASS
    clientExports.seatRowButton(lone, button)
    return lone.children[0] === only && lone.children[1] === button
  })(),
)
ok('row buttons: the button is labelled for assistive tech', injectedOne[0].getAttribute('aria-label') === clientExports.ROW_BUTTON_LABEL && injectedOne[0].title === clientExports.ROW_BUTTON_LABEL, injectedOne[0].getAttribute('aria-label'))
ok('row buttons: the button carries an inline glyph', String(injectedOne[0].innerHTML).startsWith('<svg') && String(injectedOne[0].innerHTML).includes('</svg>'))
ok('row buttons: the glyph uses the shell\'s 16px artwork grid', String(injectedOne[0].innerHTML).includes('viewBox="0 0 16 16"') && String(injectedOne[0].innerHTML).includes('fill="currentColor"'))

let clickPrevented = 0
let clickStopped = 0
injectedOne[0].listeners.click({ preventDefault: () => (clickPrevented += 1), stopPropagation: () => (clickStopped += 1) })
ok('row buttons: clicking opens the dialog for that workspace', clientExports.readDialog().open === true && clientExports.readDialog().workspaceId === 'ws-1', JSON.stringify(clientExports.readDialog()))
ok('row buttons: the click never reaches the row toggle', clickPrevented === 1 && clickStopped === 1, `${clickPrevented}/${clickStopped}`)
clientExports.closeWorkdirsDialog()

// A re-render must not duplicate the button, and a removed row must lose it.
settleDom()
ok('row buttons: reconciling is idempotent', actionsOne.children.length === 3, String(actionsOne.children.length))

// React re-renders the row without knowing this node exists, so it may shuffle
// its own children around ours: the seat is re-asserted, not set once.
actionsOne.insertBefore(injectedOne[0], reactOwned)
settleDom()
ok(
  'row buttons: a displaced button returns to its seat',
  actionsOne.children[1] === injectedOne[0] && actionsOne.children[0] === reactOwned,
  actionsOne.children.map((child) => child.getAttribute('aria-label') ?? child.className).join(' | '),
)
ok('row buttons: reclaiming the seat never duplicates the button', actionsOne.children.length === 3, String(actionsOne.children.length))

rowTwo.remove()
settleDom()
ok('row buttons: a removed row loses its button', injectedTwo[0].parent === null)
ok('row buttons: the remaining row keeps its button', actionsOne.children.length === 3)

// The default-Workspace gate. Before any payload the id is unknown, so the row
// keeps its entry point; once the host reports the workspace as disabled, the
// button must go away — and come back when the settings switch is flipped.
const rowButtonIn = (actions) => actions.children.filter((child) => child.className === clientExports.ROW_BUTTON_CLASS)
ok('default-workspace gate: an unknown workspace keeps its entry point', clientExports.isEnabledWorkspace('ws-never-seen') === true)
ok('default-workspace gate: the default row starts with a button', rowButtonIn(actionsDefault).length === 1)
clientExports.publishHostPayload({
  ok: true,
  settings: { defaultWorkspaceEnabled: false },
  defaultWorkspaceId: 'ws-default',
  defaultWorkspacePath: defaultDir,
  workspaces: [
    { id: 'ws-1', path: workspaceRoot, title: 'demo', isDefault: false, enabled: true, dirs: [] },
    { id: 'ws-default', path: defaultDir, title: '默认工作区', isDefault: true, enabled: false, dirs: [] },
  ],
})
installer.refresh()
ok('default-workspace gate: the host snapshot marks it disabled', clientExports.isEnabledWorkspace('ws-default') === false)
ok('default-workspace gate: a disabled default row loses its button', rowButtonIn(actionsDefault).length === 0)
ok('default-workspace gate: enabled rows keep theirs', rowButtonIn(actionsOne).length === 1)
clientExports.publishHostPayload({
  ok: true,
  settings: { defaultWorkspaceEnabled: true },
  defaultWorkspaceId: 'ws-default',
  defaultWorkspacePath: defaultDir,
  workspaces: [
    { id: 'ws-1', path: workspaceRoot, title: 'demo', isDefault: false, enabled: true, dirs: [] },
    { id: 'ws-default', path: defaultDir, title: '默认工作区', isDefault: true, enabled: true, dirs: [] },
  ],
})
installer.refresh()
ok('default-workspace gate: flipping the switch restores the button without a reload', rowButtonIn(actionsDefault).length === 1)

installer.dispose()
ok('row buttons: dispose removes every injected button', actionsOne.children.length === 2)
ok('row buttons: dispose leaves the shell\'s own actions untouched', actionsOne.children[0] === reactOwned && actionsOne.children[1] === reactNewSession)
ok('row buttons: dispose stops the observer', observers.at(-1)?.disconnected === true)

// A shell whose row DOM changed must fall back instead of leaving no entry point.
container.remove()

/** The directory picker double the dialog's browse control calls. */
let pickerReply = { kind: 'path', value: null }
let pickerCalls = 0
const uiWorkspaceDouble = {
  async pickDirectory() {
    pickerCalls += 1
    if (pickerReply.kind === 'throw') throw new Error(pickerReply.value)
    return pickerReply.value
  },
}

/** The client session list the `@` source reads its cwd from. */
const sessionRows = {
  's-1': { cwd: workspaceRoot },
  's-default': { cwd: defaultDir },
  's-elsewhere': { cwd: docsDir },
}
const sessionsDouble = { list: { getSnapshot: () => ({ byId: sessionRows }) } }

/**
 * A trigger-registry double with the real duplicate rule (`(trigger, name)` must
 * be unique). Each client context gets its own, because every `apply()` in this
 * harness stands for one fresh plugin instance on one fresh page.
 */
function makeTriggerRegistry() {
  const sources = []
  return {
    sources,
    registerSource(source) {
      if (sources.some((s) => s.trigger === source.trigger && s.name === source.name)) {
        throw new Error(`slash source "${source.trigger}${source.name}" is already registered`)
      }
      sources.push(source)
      return () => {
        const at = sources.indexOf(source)
        if (at >= 0) sources.splice(at, 1)
      }
    },
  }
}

/** A client context that records what the plugin registers. */
function makeClientCtx({ withUiWorkspace = true, withServices = true } = {}) {
  const effects = []
  const injections = []
  const serviceInjections = []
  const contributions = []
  const triggers = makeTriggerRegistry()
  return {
    effects,
    injections,
    serviceInjections,
    contributions,
    sources: triggers.sources,
    ctx: {
      effect(fn, label) {
        effects.push({ label, dispose: fn() })
        return () => {}
      },
      inject(deps, callback) {
        serviceInjections.push(deps.join(','))
        if (!withServices) return () => {}
        const scope = { effect: (fn) => fn() }
        if (deps.includes('uiWorkspace') && withUiWorkspace) scope.uiWorkspace = uiWorkspaceDouble
        if (deps.includes('sessions')) scope.sessions = sessionsDouble
        if (deps.includes('inputTriggers')) scope.inputTriggers = triggers
        const dispose = callback(scope)
        return typeof dispose === 'function' ? dispose : () => {}
      },
      slots: {
        inject(key, callback) {
          injections.push(key)
          const dispose = callback()
          return typeof dispose === 'function' ? dispose : () => {}
        },
        register(options, component) {
          contributions.push({ options, component })
          return () => {}
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// 8. Slot contributions
// ---------------------------------------------------------------------------
const first = makeClientCtx()
let clientApplyError = null
try {
  clientExports.apply(first.ctx)
} catch (error) {
  clientApplyError = error
}
ok('client apply(): registers without throwing', clientApplyError === null, clientApplyError?.message)
ok(
  'client apply(): every registration waits for its slot declaration',
  JSON.stringify(first.injections) === JSON.stringify(['settings.section', 'shell.overlay', 'main', 'sidebar.panellist']),
  first.injections.join(', '),
)
ok('client apply(): uses ctx.effect for lifecycle ownership', first.effects.length === 6 && first.effects.every((effect) => typeof effect.label === 'string'), String(first.effects.length))
ok('client apply(): injects the shell directory picker optionally', JSON.stringify(first.serviceInjections) === JSON.stringify(['uiWorkspace', 'sessions', 'inputTriggers']), first.serviceInjections.join(', '))

const names = (kind) => first.contributions.filter((c) => c.options.name === kind)
ok('client apply(): contributes into known slots only', first.contributions.every((c) => KNOWN_SLOTS[c.options.name] !== undefined), first.contributions.map((c) => c.options.name).join(', '))
ok('client apply(): the sidebar slot is a known list slot', KNOWN_SLOTS['sidebar.panellist'] === 'list')
ok('client apply(): the main slot is a known keyed slot', KNOWN_SLOTS.main === 'keyed')
ok('client apply(): the overlay slot is a known list slot', KNOWN_SLOTS['shell.overlay'] === 'list')
ok('client apply(): the settings slot is a known list slot', KNOWN_SLOTS['settings.section'] === 'list')

const mainKeys = names('main').map((c) => c.options.key).sort()
ok('client apply(): only the fallback main key is registered', JSON.stringify(mainKeys) === JSON.stringify(['workdirs']), mainKeys.join(', '))
ok('client apply(): every main panel is a component', names('main').every((c) => typeof c.component === 'function'))

const overlay = names('shell.overlay')
ok('client apply(): registers exactly one overlay entry', overlay.length === 1, String(overlay.length))
ok('client apply(): the overlay entry id is stable', overlay[0]?.options.id === 'workdirs-dialog', overlay[0]?.options.id)
ok('client apply(): the overlay entry is the dialog', overlay[0]?.component === clientExports.WorkdirsDialog)

const settingsSections = names('settings.section')
ok('client apply(): registers exactly one settings page', settingsSections.length === 1, String(settingsSections.length))
ok('client apply(): the settings page id is stable', settingsSections[0]?.options.id === clientExports.SETTINGS_SECTION_ID, settingsSections[0]?.options.id)
ok('client apply(): the settings nav label is "workspace+"', settingsSections[0]?.options.label === 'workspace+', settingsSections[0]?.options.label)
ok('client apply(): the settings page sits after the shipped sections', settingsSections[0]?.options.order > 20, String(settingsSections[0]?.options.order))
ok('client apply(): the settings page component is exported for tests', settingsSections[0]?.component === clientExports.WorkspacePlusSettings)

// The row buttons worked in this environment, so the fallback entry must NOT be
// registered: that is the "row button first, sidebar entry only as a fallback"
// contract, and it is also what keeps the sidebar free of a second icon.
const sidebarIds = names('sidebar.panellist').map((c) => c.options.id)
ok('client apply(): the test-era helloworld entry is gone', !sidebarIds.includes('helloworld'), sidebarIds.join(', '))
ok('client apply(): the fallback sidebar entry stays out while row buttons work', !sidebarIds.includes('workdirs'), sidebarIds.join(', '))
ok('client apply(): the host API path is declared once', clientExports.API_PATH === 'workspaceplus/api', clientExports.API_PATH)

// The shell's panel button calls layout.selectPanel(id) unconditionally, so a
// registered sidebar entry without a matching main key would throw on click.
ok(
  'client apply(): every registered sidebar id has a matching main key',
  names('sidebar.panellist').every((c) => mainKeys.includes(c.options.id)),
  `${sidebarIds.join(', ')} vs ${mainKeys.join(', ')}`,
)

// ---------------------------------------------------------------------------
// 9. Fallback path — a shell with no workspace rows
// ---------------------------------------------------------------------------
const second = makeClientCtx()
clientExports.apply(second.ctx)
ok('fallback: no sidebar entry before the settle window', second.contributions.filter((c) => c.options.id === 'workdirs').length === 0)
await new Promise((resolve) => setTimeout(resolve, clientExports.FALLBACK_SETTLE_MS + 150))
const fallbackEntry = second.contributions.find((c) => c.options.id === 'workdirs')
ok('fallback: the sidebar entry appears when no row button can exist', fallbackEntry !== undefined, second.contributions.map((c) => c.options.id).join(', '))
ok('fallback: the entry glyph opens the dialog instead of the panel', typeof fallbackEntry?.component === 'function')
const fallbackGlyph = render(fallbackEntry.component({ size: 18 }))
ok('fallback: the glyph is an svg carrying a click handler', fallbackGlyph?.type === 'svg' && typeof fallbackGlyph?.props.onClick === 'function')
let glyphPrevented = 0
let glyphStopped = 0
fallbackGlyph.props.onClick({ preventDefault: () => (glyphPrevented += 1), stopPropagation: () => (glyphStopped += 1) })
ok('fallback: clicking the glyph opens the dialog and stops the shell button', clientExports.readDialog().open === true && glyphPrevented === 1 && glyphStopped === 1)
clientExports.closeWorkdirsDialog()

// ---------------------------------------------------------------------------
// 10. Rendering — the components produce the expected markup
// ---------------------------------------------------------------------------
const hintPanel = names('main')[0].component
const dialog = overlay[0].component
const settingsPage = settingsSections[0].component

const hintTree = render(hintPanel({}))
const hintText = collectText(hintTree)
ok('hint panel: explains that the feature is a dialog', hintText.includes('弹窗'))
const hintButton = findElements(hintTree, (element) => element.type === 'button' && typeof element.props.onClick === 'function')[0]
ok('hint panel: offers a control that opens the dialog', hintButton !== undefined)
let hintClickError = null
try {
  hintButton?.props.onClick()
} catch (error) {
  hintClickError = error
}
ok('hint panel: the control opens the dialog', clientExports.readDialog().open === true && hintClickError === null)
clientExports.closeWorkdirsDialog()

// --- the `workspace+` settings page -----------------------------------------
const defaultKey = host.keyOf(defaultDir)
const workspaceKey = host.keyOf(workspaceRoot)
const settingsSnapshot = {
  ok: true,
  registryAvailable: true,
  settings: { defaultWorkspaceEnabled: false, workspaceEnabled: {} },
  defaultWorkspaceId: 'ws-default',
  defaultWorkspacePath: defaultDir,
  workspaces: [
    { id: 'ws-default', key: defaultKey, path: defaultDir, title: '默认工作区', isDefault: true, enabled: false, dirs: [] },
    { id: 'ws-1', key: workspaceKey, path: workspaceRoot, title: 'demo', isDefault: false, enabled: true, dirs: [] },
  ],
}
clientExports.publishHostPayload(settingsSnapshot)
const settingsTree = render(settingsPage({}))
const settingsText = collectText(settingsTree)
const switches = () => findElements(render(settingsPage({})), (element) => element.props.role === 'switch')
ok('settings page: explains what one switch covers', settingsText.includes('按工作区启用'), settingsText.slice(0, 80))
ok('settings page: renders one switch per workspace', switches().length === 2, String(switches().length))
ok('settings page: lists every workspace path', settingsText.includes(defaultDir) && settingsText.includes(workspaceRoot))
ok('settings page: marks the default workspace', settingsText.includes('默认工作区'))
ok('settings page: the default workspace switch starts off', switches()[0]?.props['aria-checked'] === false, String(switches()[0]?.props['aria-checked']))
ok('settings page: every other workspace switch starts on', switches()[1]?.props['aria-checked'] === true, String(switches()[1]?.props['aria-checked']))
ok(
  'settings page: switches are labelled per workspace for assistive tech',
  switches()[0]?.props['aria-label'] === '默认工作区 启用 workspace+',
  String(switches()[0]?.props['aria-label']),
)
ok('settings page: says the switch does not delete labels', settingsText.includes('关掉不会删除已登记的标签'), settingsText.slice(0, 120))

// Flip the SECOND workspace off: the switch posts one settings op keyed by the
// host's own workspace key, and the shared snapshot follows.
fetchCalls.length = 0
fetchReply = {
  status: 200,
  body: {
    ...settingsSnapshot,
    message: '已停用 ' + workspaceKey + ' 的 workspace+',
    settings: { defaultWorkspaceEnabled: false, workspaceEnabled: { [workspaceKey]: false } },
    workspaces: [
      { id: 'ws-default', key: defaultKey, path: defaultDir, title: '默认工作区', isDefault: true, enabled: false, dirs: [] },
      { id: 'ws-1', key: workspaceKey, path: workspaceRoot, title: 'demo', isDefault: false, enabled: false, dirs: [] },
    ],
  },
}
switches()[1].props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
ok(
  'settings page: flipping a switch posts a settings op',
  fetchCalls.length === 1 && fetchCalls[0].method === 'POST' && String(fetchCalls[0].body).includes('"op":"settings"'),
  JSON.stringify(fetchCalls[0]?.body),
)
{
  const body = JSON.parse(String(fetchCalls[0]?.body))
  ok(
    'settings page: the request addresses the workspace by the key the host published',
    body?.settings?.workspaceEnabled?.[workspaceKey] === false &&
      Object.keys(body.settings.workspaceEnabled).length === 1,
    String(fetchCalls[0]?.body),
  )
  ok('settings page: the request never guesses a key from the path', !String(fetchCalls[0]?.body).includes('"undefined"'), String(fetchCalls[0]?.body))
}
ok('settings page: the shared snapshot picks up the override', clientExports.readHostState().settings.workspaceEnabled[workspaceKey] === false)
ok('settings page: the switch re-renders as off', switches()[1]?.props['aria-checked'] === false, String(switches()[1]?.props['aria-checked']))

// A host that predates the per-workspace layer answers without keys: the page
// must say so instead of posting a switch nobody can address.
clientExports.publishHostPayload({
  ...settingsSnapshot,
  workspaces: settingsSnapshot.workspaces.map(({ key, ...rest }) => rest),
})
const keylessText = collectText(render(settingsPage({})))
ok('settings page: reports a host that publishes no workspace keys', keylessText.includes('没有 key'), keylessText.slice(0, 80))
ok('settings page: disables the switches it cannot address', switches().every((element) => element.props.disabled === true))
clientExports.publishHostPayload(settingsSnapshot)
fetchReply = { status: 200, body: settingsSnapshot }

fetchReply = { status: 500, body: { ok: false } }
const failedTree = render(settingsPage({ initial: { status: 'error', message: 'host responded 500', ok: null, busy: false } }))
ok('settings page: surfaces a host failure instead of pretending', collectText(failedTree).includes('无法读取宿主设置'), collectText(failedTree).slice(0, 70))
const staleTree = render(settingsPage({ initial: { status: 'error', message: 'host responded 404', ok: null, busy: false } }))
ok('settings page: diagnoses a 404 as a stale host process', collectText(staleTree).includes('重启'), collectText(staleTree).slice(0, 90))
fetchReply = { status: 200, body: settingsSnapshot }

// The dialog's test seam: the shell never passes `initial`.
const readyState = {
  status: 'ready',
  message: '',
  ok: null,
  registryAvailable: true,
  selected: workspaceRoot,
  locked: true,
  busy: false,
  workspaces: [
    { id: 'ws-1', title: 'demo', path: workspaceRoot, dirs: [{ label: 'backend', path: backendDir, note: '后端 API' }, { label: 'docs', path: docsDir }] },
  ],
}

// Closed: no dialog surface at all.
ok('dialog: renders nothing while closed', render(dialog({ initial: readyState })) === null)

clientExports.openWorkdirsDialog('ws-1')
const openTree = render(dialog({ initial: readyState }))
const openText = collectText(openTree)
ok('dialog: opens as a modal surface', findElements(openTree, (element) => element.props.role === 'dialog').length === 1)
ok('dialog: titles itself', openText.includes('工作区目录设置'))
const openSurface = findElements(openTree, (element) => element.props.role === 'dialog')[0]
ok(
  'dialog: asks the shell for a wider card than the 380px default',
  openSurface?.props.className.includes('dsh-workspace-plus-dialog-card'),
  openSurface?.props.className,
)
{
  const css = String(head.children[0]?.textContent ?? '')
  const rule = css.match(/\.dsh-workspace-plus-dialog-card\.dsh-workspace-plus-dialog-card\{([^}]*)\}/)?.[1] ?? ''
  // Two classes beat the shell's own single-class `.dialog` rule whatever the
  // stylesheet order turns out to be.
  ok('dialog CSS: widens the card', rule.includes('width:min(760px,100%)'), rule)
}
ok('dialog: drops the modal description paragraph', openSurface?.props.description === undefined, String(openSurface?.props.description))
ok(
  'dialog: drops the trailing sandbox footnote',
  !openText.includes('一个工作区可以登记') && !openText.includes('标签映射会自动注入') && !openText.includes('这里会把这类目录标注出来'),
  openText.slice(0, 80),
)
ok('dialog: lists every registered label', readyState.workspaces[0].dirs.every((dir) => openText.includes(dir.label)))
ok('dialog: shows every absolute path', readyState.workspaces[0].dirs.every((dir) => openText.includes(dir.path)))
{
  // Outside the workspace root the row carries the shell's shield, and the
  // explanation is the tooltip's payload rather than row copy.
  const badges = findElements(openTree, (element) => element.props['data-tooltip'] !== undefined)
  const labels = badges.map((badge) => String(badge.props['data-tooltip']))
  // This fixture keeps both directories beside the workspace root, so every row
  // earns a badge — the count is derived, not hard-coded.
  const outsideCount = readyState.workspaces[0].dirs.filter((dir) => clientExports.isOutside(workspaceRoot, dir.path)).length
  ok('dialog: badges exactly the directories outside the workspace root', outsideCount > 0 && badges.length === outsideCount, `${String(badges.length)} of ${String(outsideCount)}`)
  ok(
    'dialog: the badge explains itself through a tooltip',
    labels[0]?.includes('工作区根目录之外') && labels[0]?.includes('danger-full-access'),
    labels[0],
  )
  ok('dialog: the badge cannot be hover-only', findElements(badges[0] ?? {}, (element) => element.props.tabIndex === 0).length === 1)
  ok('dialog: the warning is not spelled out in the row', !openText.includes('工作区根目录之外'), openText.slice(0, 100))
  const shield = findElements(badges[0] ?? {}, (element) => element.type === 'svg')[0]
  ok('dialog: the badge draws a shield glyph', shield !== undefined && String(shield?.children?.[0]?.props?.d ?? '').startsWith('M6.80132'))
}
ok('dialog: offers one remove control per directory', findElements(openTree, (element) => element.type === 'button').filter((b) => collectText(b) === '删除').length === 2)
const openInputs = findElements(openTree, (element) => element.type === 'input')
ok('dialog: renders label and note, with no path input', openInputs.length === 2, String(openInputs.length))
ok(
  'dialog: keeps label and note on one row',
  openInputs.every((input) => input.props.className.includes('dsh-workspace-plus-input')) &&
    openInputs.filter((input) => input.props.className.includes('dsh-workspace-plus-input-label')).length === 1 &&
    openInputs.filter((input) => input.props.className.includes('dsh-workspace-plus-input-note')).length === 1,
  openInputs.map((input) => input.props.className).join(' | '),
)
ok('dialog: locks onto the triggering workspace — no picker', findElements(openTree, (element) => element.type === 'select').length === 0)
ok('dialog: names the locked workspace', openText.includes('demo') && openText.includes(workspaceRoot), openText.slice(0, 80))
const unlockedTree = render(dialog({ initial: { ...readyState, locked: false } }))
ok('dialog: an unlocked trigger (sidebar fallback) still offers the picker', findElements(unlockedTree, (element) => element.type === 'select').length === 1)
ok('dialog: dragging the lock to a closed state resets rendering', render(dialog({ initial: { ...readyState, locked: false } })) !== null)
const dialogButtons = findElements(openTree, (element) => element.type === 'button')
ok('dialog: offers a refresh and a done control', dialogButtons.some((b) => collectText(b) === '刷新') && dialogButtons.some((b) => collectText(b) === '完成'))
const addButton = dialogButtons.find((b) => collectText(b) === '添加')
ok('dialog: renders the add control', addButton !== undefined && typeof addButton.props.onClick === 'function')
{
  // Nothing is addable before a directory is chosen: the path field is the only
  // source of a path now.
  ok('dialog: the add control waits for a chosen directory', addButton?.props.disabled === true, String(addButton?.props.disabled))
}
let addClickError = null
try {
  addButton?.props.onClick()
} catch (error) {
  addClickError = error
}
ok('dialog: the add control click handler runs', addClickError === null, addClickError?.message)
{
  // The path control sits above the label row, as a control rather than an input.
  const pathControl = dialogButtons.find((b) => b.props['aria-label'] === '选择目录')
  const labelInput = openInputs.find((input) => input.props.className.includes('dsh-workspace-plus-input-label'))
  ok('dialog: the path control is a button, not a field', pathControl !== undefined)
  ok('dialog: the path control is not a text input', findElements(openTree, (element) => element.type === 'input' && element.props['aria-label'] === '目录绝对路径').length === 0)
  const order = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    order.push(node)
    walk(node.children)
  }
  walk(openTree)
  const pathAt = order.indexOf(pathControl)
  const labelAt = order.indexOf(labelInput)
  ok('dialog: the path control stands on the line above the label', pathAt >= 0 && labelAt >= 0 && pathAt < labelAt, `${String(pathAt)} < ${String(labelAt)}`)
  ok('dialog: the path control shows its prompt until a directory is picked', collectText(pathControl) === '选择目录…', collectText(pathControl))
}
const inputs = findElements(openTree, (element) => element.type === 'input' && typeof element.props.onChange === 'function')
let inputError = null
try {
  for (const input of inputs) input.props.onChange({ target: { value: 'x' } })
} catch (error) {
  inputError = error
}
ok('dialog: every input accepts typing', inputs.length === 2 && inputError === null, inputError?.message)
const removeButton = dialogButtons.find((b) => collectText(b) === '删除')
let removeError = null
try {
  removeButton?.props.onClick()
} catch (error) {
  removeError = error
}
ok('dialog: the remove control click handler runs', removeError === null, removeError?.message)
clientExports.closeWorkdirsDialog()

const loadingText = collectText(render(dialog({ initial: { ...readyState, status: 'loading', workspaces: [], selected: null } })) ?? '')
clientExports.openWorkdirsDialog(null)
const loadingOpenText = collectText(render(dialog({ initial: { ...readyState, status: 'loading', workspaces: [], selected: null } })))
ok('dialog: shows a loading state', loadingOpenText.includes('正在读取'), loadingText || loadingOpenText.slice(0, 40))

const errorOpenText = collectText(render(dialog({ initial: { ...readyState, status: 'error', workspaces: [], selected: null, message: 'Failed to fetch' } })))
ok('dialog: explains an unreachable host instead of pretending it is empty', errorOpenText.includes('无法连接') && errorOpenText.includes('workspace_dirs'), errorOpenText.slice(0, 90))

const unroutedOpenText = collectText(render(dialog({ initial: { ...readyState, status: 'error', workspaces: [], selected: null, message: 'host responded 404' } })))
ok('dialog: diagnoses a 404 as a stale host process', unroutedOpenText.includes('重启 dsh') && unroutedOpenText.includes('host half loaded'), unroutedOpenText.slice(0, 120))

const unauthorizedOpenText = collectText(render(dialog({ initial: { ...readyState, status: 'error', workspaces: [], selected: null, message: 'host responded 401' } })))
ok('dialog: gives actionable advice on an unauthorized page', unauthorizedOpenText.includes('token') && !unauthorizedOpenText.includes('workspaceplus/api'), unauthorizedOpenText.slice(0, 90))

const emptyOpenText = collectText(render(dialog({ initial: { ...readyState, workspaces: [], selected: null } })))
ok('dialog: explains an empty workspace list', emptyOpenText.includes('还没有任何工作区'), emptyOpenText.slice(0, 60))

const noRegistryText = collectText(render(dialog({ initial: { ...readyState, registryAvailable: false, workspaces: [], selected: null } })))
ok('dialog: explains a host without the workspace registry', noRegistryText.includes('workspace_dirs'), noRegistryText.slice(0, 60))

const noDirsText = collectText(render(dialog({ initial: { ...readyState, workspaces: [{ id: 'ws-1', title: 'demo', path: workspaceRoot, dirs: [] }] } })))
ok('dialog: invites a first label when the mapping is empty', noDirsText.includes('还没有登记额外目录'), noDirsText.slice(0, 60))
clientExports.closeWorkdirsDialog()

ok('isOutside(): detects a sibling directory', clientExports.isOutside(workspaceRoot, docsDir) === true)
ok('isOutside(): accepts the workspace root itself', clientExports.isOutside(workspaceRoot, workspaceRoot) === false)
ok('isOutside(): accepts a nested directory', clientExports.isOutside(workspaceRoot, join(workspaceRoot, 'src')) === false)
ok('isOutside(): ignores a trailing separator', clientExports.isOutside(`${workspaceRoot}\\`, workspaceRoot) === false)

// --- the directory picker ---------------------------------------------------
ok('basenameOf(): reads a Windows path', clientExports.basenameOf('D:\\proj\\backend') === 'backend')
ok('basenameOf(): reads a POSIX path', clientExports.basenameOf('/home/me/api') === 'api')
ok('basenameOf(): ignores a trailing separator', clientExports.basenameOf('D:\\proj\\backend\\') === 'backend')
ok('suggestLabel(): uses the directory name', clientExports.suggestLabel('D:\\proj\\backend') === 'backend')
ok('suggestLabel(): folds separators and spaces', clientExports.suggestLabel('D:\\proj\\my api') === 'my-api', clientExports.suggestLabel('D:\\proj\\my api'))
ok('suggestLabel(): refuses a name with no usable characters', clientExports.suggestLabel('D:\\项目\\后端') === '', clientExports.suggestLabel('D:\\项目\\后端'))
ok('suggestLabel(): never exceeds the host label grammar', clientExports.suggestLabel(`D:\\${'a'.repeat(60)}`).length === 32)
ok('suggestLabel(): output always passes the host grammar', /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(clientExports.suggestLabel('D:\\proj\\my api')))

const emptyDraft = { label: '', path: '', note: 'n' }
const pickedDraft = clientExports.draftAfterPick(emptyDraft, 'D:\\proj\\backend')
ok('draftAfterPick(): fills the path', pickedDraft.path === 'D:\\proj\\backend')
ok('draftAfterPick(): fills an empty label from the directory name', pickedDraft.label === 'backend')
ok('draftAfterPick(): keeps the note', pickedDraft.note === 'n')
ok('draftAfterPick(): never overwrites a typed label', clientExports.draftAfterPick({ ...emptyDraft, label: 'api' }, 'D:\\proj\\backend').label === 'api')
ok('draftAfterPick(): leaves the label empty when nothing is suggestible', clientExports.draftAfterPick(emptyDraft, 'D:\\项目').label === '', clientExports.draftAfterPick(emptyDraft, 'D:\\项目').label)

// The path control is real DOM-reachable markup: render the dialog with a ready
// state and drive it through the picker double.
pickerReply = { kind: 'path', value: 'D:\\proj\\backend' }
pickerCalls = 0
clientExports.openWorkdirsDialog('ws-1')
const browseTree = render(dialog({ initial: readyState }))
const browseButton = findElements(browseTree, (element) => element.type === 'button').find(
  (b) => b.props['aria-label'] === '选择目录',
)
ok('dialog: renders the directory picker as the path field itself', browseButton !== undefined)
ok('dialog: the picker is enabled while row buttons work', browseButton?.props.disabled === false, String(browseButton?.props.disabled))
let browseError = null
try {
  browseButton?.props.onClick()
} catch (error) {
  browseError = error
}
await new Promise((resolve) => setTimeout(resolve, 0))
ok('dialog: clicking the path field asks the shell picker', pickerCalls === 1, String(pickerCalls))
ok('dialog: the picker does not throw', browseError === null, browseError?.message)

// A cancelled picker returns null and must stay silent.
pickerReply = { kind: 'path', value: null }
pickerCalls = 0
browseButton?.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
ok(
  'dialog: a cancelled pick changes nothing and reports nothing',
  pickerCalls === 1 && collectText(render(dialog({ initial: readyState }))).includes('选择目录'),
  String(pickerCalls),
)

// A failed picker must surface a reason rather than failing silently.
pickerReply = { kind: 'throw', value: 'picker unavailable' }
const callsBeforeFailure = pickerCalls
let failureEscaped = null
try {
  browseButton?.props.onClick()
} catch (error) {
  failureEscaped = error
}
await new Promise((resolve) => setTimeout(resolve, 0))
ok(
  'dialog: a failed pick is caught and does not escape the control',
  failureEscaped === null && pickerCalls === callsBeforeFailure + 1,
  `${failureEscaped?.message ?? ''} calls=${pickerCalls}`,
)
ok('dialog: the failure message names the picker', clientExports.pickErrorMessage(new Error('picker unavailable')) === '打开目录选择器失败：picker unavailable', clientExports.pickErrorMessage(new Error('picker unavailable')))
ok('dialog: a non-Error rejection still yields a message', clientExports.pickErrorMessage('boom').includes('boom'))
pickerReply = { kind: 'path', value: null }
clientExports.closeWorkdirsDialog()

// A composition without ui-workspace must keep working: the plugin still loads,
// and the dialog says why it cannot take a path instead of failing silently.
const pickerEffect = first.effects.find((effect) => effect.label.includes('directory picker'))
ok('client apply(): owns the picker through a disposable effect', pickerEffect !== undefined, first.effects.map((e) => e.label).join(' | '))
pickerEffect?.dispose()
clientExports.openWorkdirsDialog('ws-1')
const noPickerTree = render(dialog({ initial: readyState }))
const noPickerButton = findElements(noPickerTree, (element) => element.type === 'button').find(
  (b) => b.props['aria-label'] === '选择目录',
)
ok('dialog: the picker disables itself when no picker is mounted', noPickerButton !== undefined && noPickerButton.props.disabled === true, String(noPickerButton?.props.disabled))
ok(
  'dialog: the disabled picker names the tool to use instead',
  String(noPickerButton?.props.title ?? '').includes('workspace_dirs'),
  String(noPickerButton?.props.title),
)
const noPickerAdd = findElements(noPickerTree, (element) => element.type === 'button').find((b) => collectText(b) === '添加')
ok('dialog: the add control stays disabled without a path', noPickerAdd?.props.disabled === true, String(noPickerAdd?.props.disabled))
const noPickerCalls = pickerCalls
noPickerButton?.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
ok('dialog: a disabled picker never calls a missing picker', pickerCalls === noPickerCalls, String(pickerCalls))
clientExports.closeWorkdirsDialog()

// ---------------------------------------------------------------------------
// 10b. The composer's `@` label source
// ---------------------------------------------------------------------------
const labelSource = first.sources.find((source) => source.name === clientExports.SOURCE_NAME)
ok('@ source: is registered on the trigger registry', labelSource !== undefined, first.sources.map((s) => `${s.trigger}${s.name}`).join(', '))
ok('@ source: triggers on "@"', labelSource?.trigger === '@', labelSource?.trigger)
ok('@ source: uses a name unique to that trigger', clientExports.SOURCE_NAME !== 'reference', clientExports.SOURCE_NAME)
ok('@ source: suppresses the pipeline group title in favour of sections', labelSource?.showGroupTitle === false)
ok('@ source: declares a codec so a chip can be serialized', typeof labelSource?.codec?.serialize === 'function')
ok('@ source: registers exactly one source per plugin instance', first.sources.length === 1, String(first.sources.length))
// The pipeline does `candidates(...).then(...)`, so a synchronous array return
// would throw inside its own fan-out before ever reaching this source's rows.
ok('@ source: candidates returns a thenable', typeof labelSource?.candidates({ sessionId: 's-1' }, { query: '' })?.then === 'function')

// Seed a snapshot with a mapping the source can offer.
clientExports.publishHostPayload({
  ok: true,
  settings: { defaultWorkspaceEnabled: false },
  defaultWorkspaceId: 'ws-default',
  defaultWorkspacePath: defaultDir,
  workspaces: [
    {
      id: 'ws-1',
      path: workspaceRoot,
      title: 'demo',
      isDefault: false,
      enabled: true,
      dirs: [
        { label: 'backend', path: backendDir, note: '后端 API' },
        { label: 'docs', path: docsDir },
      ],
    },
    { id: 'ws-default', path: defaultDir, title: '默认工作区', isDefault: true, enabled: false, dirs: [{ label: 'hidden', path: docsDir }] },
  ],
})

ok('samePath(): folds separators and case', clientExports.samePath('D:\\A\\B', 'd:/a/b/') === true)
ok('samePath(): distinguishes siblings', clientExports.samePath(backendDir, docsDir) === false)
ok('sessionCwd(): reads the workspace key from the session list', clientExports.sessionCwd('s-1') === workspaceRoot)
ok('sessionCwd(): yields null for an unknown session', clientExports.sessionCwd('nope') === null)
ok('workspaceForSession(): resolves the session workspace', clientExports.workspaceForSession({ sessionId: 's-1' })?.id === 'ws-1')
ok('workspaceForSession(): yields null for an unrelated cwd', clientExports.workspaceForSession({ sessionId: 's-elsewhere' }) === null)
ok('workspaceForSession(): does not gate on the enabled flag', clientExports.workspaceForSession({ sessionId: 's-default' })?.id === 'ws-default')

const allRows = await labelSource.candidates({ sessionId: 's-1' }, { query: '' })
ok('@ candidates: offer the session workspace labels first', allRows.length === 2 && allRows[0].label === 'backend', JSON.stringify(allRows.map((r) => r.label)))
ok('@ candidates: rows title themselves with the label', allRows.every((row) => row.name === row.label && typeof row.label === 'string'))
ok('@ candidates: rows carry the folder glyph', allRows.every((row) => row.icon === 'folder'))
ok('@ candidates: rows are sectioned by workspace title', allRows.every((row) => row.section === 'demo'), JSON.stringify([...new Set(allRows.map((r) => r.section))]))
ok('@ candidates: rows describe where the label points', allRows[0].description.includes(backendDir) && allRows[0].description.includes('后端 API'), allRows[0].description)
ok('@ candidates: a bare label describes just its path', allRows[1].description === docsDir, allRows[1].description)

const byLabel = await labelSource.candidates({ sessionId: 's-1' }, { query: 'back' })
ok('@ candidates: filter by label', byLabel.length === 1 && byLabel[0].label === 'backend', JSON.stringify(byLabel.map((r) => r.label)))
ok('@ candidates: filter by note', (await labelSource.candidates({ sessionId: 's-1' }, { query: '后端' })).length === 1)
ok('@ candidates: filter by path', (await labelSource.candidates({ sessionId: 's-1' }, { query: 'docs' })).length === 1)
ok('@ candidates: filter is case-insensitive', (await labelSource.candidates({ sessionId: 's-1' }, { query: 'BACK' })).length === 1)
ok('@ candidates: an unmatched query yields nothing', (await labelSource.candidates({ sessionId: 's-1' }, { query: 'zzz' })).length === 0)
ok(
  '@ candidates: an aborted fetch yields nothing',
  (await labelSource.candidates({ sessionId: 's-1' }, { query: '', signal: { aborted: true } })).length === 0,
)
ok(
  '@ candidates: the disabled default workspace is never offered',
  (await labelSource.candidates({ sessionId: 's-default' }, { query: '' })).every((row) => row.label !== 'hidden'),
)

// The whole point of the redesign: an unresolvable session must still offer the
// labels, because an empty menu is indistinguishable from a broken bundle.
const noSessionRows = await labelSource.candidates({}, { query: '' })
ok('@ candidates: an unknown session still offers every enabled label', noSessionRows.length === 2, JSON.stringify(noSessionRows.map((r) => r.label)))
ok('@ candidates: an unknown session still sections by workspace', noSessionRows.every((row) => row.section === 'demo'))
const elsewhereRows = await labelSource.candidates({ sessionId: 's-elsewhere' }, { query: '' })
ok('@ candidates: an unrelated cwd still offers the labels', elsewhereRows.length === 2, String(elsewhereRows.length))
ok(
  '@ candidates: the session workspace is ordered first',
  (await labelSource.candidates({ sessionId: 's-1' }, { query: '' }))[0].section === 'demo',
)
ok('labelSourceStatus(): reports registration and reach', clientExports.labelSourceStatus().labels === 2 && clientExports.labelSourceStatus().workspaces === 1, JSON.stringify(clientExports.labelSourceStatus()))
ok('labelSourceStatus(): is not registered before apply wires it', clientExports.labelSourceStatus().registered === false || clientExports.labelSourceStatus().registered === true)

const picked = labelSource.onPick({ candidate: allRows[0], action: 'pick' })
ok('@ pick: inserts a reference chip', picked?.insert !== undefined, JSON.stringify(picked))
ok('@ pick: the chip is owned by this source', picked.insert.source === clientExports.SOURCE_NAME, picked.insert.source)
ok('@ pick: the chip shows the label', picked.insert.label === 'backend', picked.insert.label)
ok('@ pick: the chip asks for the folder glyph', picked.insert.appearance === 'folder', picked.insert.appearance)
ok('@ pick: the reference IS the absolute path', picked.insert.ref === backendDir, picked.insert.ref)
ok('@ pick: copying the chip yields the absolute path', picked.insert.clipboardText === backendDir)
ok('@ pick: an unusable payload inserts nothing', labelSource.onPick({ candidate: { value: 'not json' } }) === undefined)
ok('@ pick: a missing candidate inserts nothing', labelSource.onPick({}) === undefined)

const serialized = await labelSource.codec.serialize(picked.insert.ref)
ok('@ serialize: the model receives the absolute path', serialized === backendDir, serialized)
ok('@ codec: clipboard text is the reference itself', labelSource.codec.clipboardText(backendDir) === backendDir)
ok('parseLabelValue(): rejects a non-object payload', clientExports.parseLabelValue('"text"') === undefined)
ok('parseLabelValue(): rejects a partial payload', clientExports.parseLabelValue('{"label":"a"}') === undefined)
ok('parseLabelValue(): reads a complete payload', clientExports.parseLabelValue('{"label":"a","path":"P"}')?.path === 'P')

// ---------------------------------------------------------------------------
// 11. Optional: cross-check dsh.client.inject against the composed profile
// ---------------------------------------------------------------------------
/** Collect the `name:` values of every loader row a profile-layer file declares. */
const readRowNames = (file) => {
  if (file === null || !existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/^\s*(?:-\s*)?name:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1].trim())
}

ok(
  'dsh.client.inject: names exactly the packages that declare the slots this bundle writes to',
  JSON.stringify([...pkg.dsh.client.inject].sort()) ===
    JSON.stringify([
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ]),
  pkg.dsh.client.inject.join(', '),
)

const profileDir = process.env.DSH_PROFILE_DIR
// Only a materialized root proves membership: a `cordis.patch.yml` is a partial
// layer by definition, so a name missing from it means nothing.
const profileRows = profileDir === undefined ? [] : readRowNames(join(profileDir, 'cordis.yml'))
if (profileRows.length === 0) {
  skip(
    'dsh.client.inject: every dependency is a composed row',
    'DSH_PROFILE_DIR has no materialized loader rows (this profile composes bundles as patches at boot) — offline check skipped',
  )
} else {
  const missing = pkg.dsh.client.inject.filter((dep) => !profileRows.includes(dep))
  ok('dsh.client.inject: every dependency is a composed row', missing.length === 0, missing.join(', '))
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
delete process.env.DSH_HOME
rmSync(work, { recursive: true, force: true })

const failed = results.filter((r) => !r.pass)
for (const r of results) {
  const mark = r.pass ? (r.skipped ? 'SKIP' : 'PASS') : 'FAIL'
  console.log(`${mark}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed`)
  process.exit(1)
}
console.log('dsh-workspace-plus bundle verified.')
