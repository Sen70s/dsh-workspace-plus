/**
 * Boots the harness: materializes the plugin's real factory against a fake Cordis
 * context that provides a directory picker, then renders the dialog.
 *
 * Everything here runs synchronously during page load, with the legacy
 * `ReactDOM.render` root, because headless screenshots are captured at load:
 * the dialog must already be in its final state at that point.
 *
 * URL flags pick the state:
 *   ?picked=1   click the path field, so a directory is chosen and the label is
 *               filled from it
 *   ?tooltip=1  hover the "outside the workspace root" badge
 */
const debug = document.createElement('pre')
debug.id = 'debug'
debug.style.cssText =
  'display:none;position:fixed;left:0;bottom:0;z-index:99999;max-width:100%;margin:0;padding:6px 8px;white-space:pre-wrap;color:#f25a5a;font:12px/1.5 monospace'
document.body.appendChild(debug)
const note = (message) => {
  debug.style.display = 'block'
  debug.textContent = String(debug.textContent ?? '') + '\n' + message
}
window.addEventListener('error', (event) => {
  note('error: ' + event.message + ' @ ' + event.filename + ':' + event.lineno)
})
window.addEventListener('unhandledrejection', (event) => {
  note('rejection: ' + String((event.reason && event.reason.stack) || event.reason))
})

const sandbox = window.__previewSandbox
const params = new URLSearchParams(location.search)

window.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return params.get('view') === 'settings' ? sandbox.SETTINGS_FIXTURE : sandbox.FIXTURE
  },
})

const plugin = window.__materializePlugin({
  react: sandbox.React,
  '@deepseek-ai/dsh-client-ui-primitives': sandbox.primitives,
})

/** A Cordis-shaped context: only what `apply()` touches, and the picker. */
window.__pickerCalls = 0
const disposers = []
const ctx = {
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
  inject(_deps, callback) {
    const dispose = callback({
      uiWorkspace: sandbox.picker,
      sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
      inputTriggers: { registerSource: () => () => {} },
      effect(fn) {
        const owned = fn()
        if (typeof owned === 'function') disposers.push(owned)
      },
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  slots: {
    inject(_name, callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register() {
      return () => {}
    },
  },
  logger: console,
}
plugin.apply(ctx)

const workspace = sandbox.FIXTURE.workspaces[0]
const READY = {
  status: 'ready',
  message: '',
  ok: null,
  registryAvailable: true,
  workspaces: sandbox.FIXTURE.workspaces,
  selected: workspace.path,
  locked: true,
  busy: false,
}
plugin.openWorkdirsDialog('ws-1')

const click = (node) => {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  }
}

const run = async () => {
  const root = document.getElementById('root')
  const settingsView = params.get('view') === 'settings'
  if (settingsView) {
    // The shell renders this section inside a settings pane; give the standalone
    // preview the same frame so the screenshot reads like the real seat. The
    // heading is a sibling of the React root, never inside it, because React owns
    // and replaces everything under the container it renders into.
    for (const node of document.querySelectorAll('.backdrop')) node.remove()
    root.style.cssText = 'max-width:760px;margin:0 auto;padding:28px 24px'
    const heading = document.createElement('div')
    heading.textContent = '设置 → workspace+'
    heading.style.cssText = 'color:#979da6;font:12px/20px system-ui;margin-bottom:14px'
    root.appendChild(heading)
  }
  const surface = document.createElement('div')
  root.appendChild(surface)
  // `flushSync` renders and commits during this task, so the surface is painted
  // before the load event the headless capture waits for.
  const reactRoot = window.ReactDOM.createRoot(surface)
  const element = settingsView
    ? sandbox.React.createElement(plugin.WorkspacePlusSettings, { initial: { status: 'ready', message: '', ok: null, busy: false } })
    : sandbox.React.createElement(plugin.WorkdirsDialog, { initial: READY })
  window.ReactDOM.flushSync(() => reactRoot.render(element))
  await null
  if (params.get('picked') === '1') {
    const field = document.querySelector('.dsh-workspace-plus-path')
    if (field !== null) click(field)
    await sandbox.picker.lastResult
    await null
    window.ReactDOM.flushSync(() => {})
    await null
  }
  if (params.get('tooltip') === '1') {
    const badge = document.querySelector('.dsh-workspace-plus-row-outside')
    if (badge !== null) {
      badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, relatedTarget: document.body }))
      badge.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    }
    await null
    window.ReactDOM.flushSync(() => {})
    await null
  }
  document.title = 'ready'
  window.__preview = {
    rows: document.querySelectorAll('.dsh-workspace-plus-row').length,
    badges: document.querySelectorAll('.dsh-workspace-plus-row-outside').length,
    bubbles: document.querySelectorAll('[role="tooltip"]').length,
    switches: document.querySelectorAll('[role="switch"]').length,
    cardWidth: document.querySelector('[role="dialog"]')?.getBoundingClientRect().width,
    pickerCalls: window.__pickerCalls,
  }
}

if (debug.textContent.includes('undefined')) debug.style.display = 'block'
void run()
