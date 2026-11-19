/**
 * Sidebar demo: a folded Workspace that still shows its working conversations.
 *
 * The rows are the shell's own markup, class names and all (rows.css). The fold
 * is NOT drawn here: boot calls the plugin's real seat against fake projections
 * and then clicks the folder row, exactly as the user would. The screenshot
 * therefore shows the plugin's fold over the shell's own Session rows.
 */
const sandbox = window.__previewSandbox

const ELLIPSIS = [
  'M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z',
  'M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z',
  'M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z',
]
const NEW_CHAT = [
  {
    d: 'M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337',
  },
  { d: 'M8 5V11' },
  { d: 'M5 8H11' },
]
const FOLDER_CLOSED = [
  { d: 'M6.79098 2.56324C7.09666 2.70214 7.34892 2.92853 7.51655 3.21365L8.1484 4.26636C8.21173 4.37188 8.32665 4.43531 8.44917 4.43531H12.5C13.0523 4.43531 13.5 4.88302 13.5 5.43531V11.5C13.5 12.6046 12.6046 13.5 11.5 13.5H4.5C3.39543 13.5 2.5 12.6046 2.5 11.5V4.5C2.5 3.39543 3.39543 2.5 4.5 2.5H6.48668C6.5918 2.5 6.69493 2.52167 6.79098 2.56324Z', o: 0.16 },
  { d: 'M6.4873 3.5H4.5C3.94772 3.5 3.5 3.94772 3.5 4.5V11.5C3.5 12.0523 3.94772 12.5 4.5 12.5H11.5C12.0523 12.5 12.5 12.0523 12.5 11.5V5.43531C12.5 5.15917 12.2761 4.93531 12 4.93531H8.44917C7.95672 4.93531 7.49664 4.68158 7.24043 4.25902L6.60986 3.2063C6.57631 3.15026 6.51528 3.11612 6.44963 3.11608L6.4873 3.5Z' },
]

const svg = (paths, stroke) => {
  const ns = 'http://www.w3.org/2000/svg'
  const node = document.createElementNS(ns, 'svg')
  node.setAttribute('width', '16')
  node.setAttribute('height', '16')
  node.setAttribute('viewBox', '0 0 16 16')
  node.setAttribute('fill', 'none')
  node.setAttribute('aria-hidden', 'true')
  for (const path of paths) {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', path.d ?? path)
    if (path.o !== undefined) p.setAttribute('opacity', String(path.o))
    if (stroke) {
      p.setAttribute('stroke', 'currentColor')
      p.setAttribute('stroke-width', '1')
    } else {
      p.setAttribute('fill', 'currentColor')
    }
    node.appendChild(p)
  }
  return node
}

/** The shell's StateDot, close enough for the extracted stylesheet. */
function stateDot(state) {
  const ns = 'http://www.w3.org/2000/svg'
  const dot = document.createElement('span')
  dot.className = '_dot_1i3xo_2'
  dot.style.width = '6px'
  dot.style.height = '6px'
  if (state !== 'ongoing') {
    dot.setAttribute('data-state', state)
    return dot
  }
  dot.setAttribute('data-state', 'ongoing')
  dot.style.color = 'var(--dsw-alias-state-business-primary)'
  const ring = document.createElementNS(ns, 'svg')
  ring.setAttribute('width', '6')
  ring.setAttribute('height', '6')
  ring.setAttribute('viewBox', '0 0 16 16')
  ring.style.animation = '_dsh-state-dot-spin_1i3xo_1 1s linear infinite'
  const circle = document.createElementNS(ns, 'circle')
  circle.setAttribute('cx', '8')
  circle.setAttribute('cy', '8')
  circle.setAttribute('r', '6')
  circle.setAttribute('fill', 'none')
  circle.setAttribute('stroke', 'currentColor')
  circle.setAttribute('stroke-width', '2')
  circle.setAttribute('stroke-dasharray', '12 26')
  circle.setAttribute('stroke-linecap', 'round')
  ring.appendChild(circle)
  dot.appendChild(ring)
  return dot
}

/** One workspace row, built exactly like the shell's ProjectRowItem. */
function buildRow({ id, label, expanded }) {
  const row = document.createElement('div')
  row.className = 'projectRow'
  row.setAttribute('data-row-key', 'workspace:' + id)
  row.setAttribute('role', 'treeitem')
  row.setAttribute('aria-expanded', expanded ? 'true' : 'false')

  const folder = document.createElement('span')
  folder.className = 'slot folder'
  folder.appendChild(svg(FOLDER_CLOSED))
  row.appendChild(folder)

  const chevron = document.createElement('span')
  chevron.className = 'slot chevron'
  const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  triangle.setAttribute('width', '14')
  triangle.setAttribute('height', '14')
  triangle.setAttribute('viewBox', '0 0 16 16')
  triangle.setAttribute('fill', 'none')
  const triPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  triPath.setAttribute('d', 'M6 3.5L11 8L6 12.5L6 3.5Z')
  triPath.setAttribute('fill', 'currentColor')
  triangle.appendChild(triPath)
  chevron.appendChild(triangle)
  row.appendChild(chevron)

  const text = document.createElement('span')
  text.className = 'projectText'
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = label
  text.appendChild(title)
  row.appendChild(text)

  const actions = document.createElement('span')
  actions.className = 'rowActions'
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'iconButton'
  more.setAttribute('aria-label', '更多')
  actions.appendChild(more)
  const newSession = document.createElement('button')
  newSession.type = 'button'
  newSession.className = 'iconButton'
  newSession.setAttribute('aria-label', '新会话')
  newSession.appendChild(svg(NEW_CHAT, true))
  actions.appendChild(newSession)
  row.appendChild(actions)

  return row
}

/** One native Session row: slot + title + time, exactly rows.css's shape. */
function buildSessionRow({ id, title, time, state }) {
  const row = document.createElement('div')
  row.className = 'sessionRow'
  row.setAttribute('data-row-key', 'session:' + id)
  row.setAttribute('role', 'treeitem')

  const slot = document.createElement('span')
  slot.className = 'slot'
  if (state !== 'idle') slot.appendChild(stateDot(state))
  const titleEl = document.createElement('span')
  titleEl.className = 'title'
  titleEl.textContent = title
  const timeEl = document.createElement('span')
  timeEl.className = 'time'
  timeEl.textContent = time
  row.appendChild(slot)
  row.appendChild(titleEl)
  row.appendChild(timeEl)
  return row
}

const sidebar = document.getElementById('sidebar')
const groupFor = (spec) => {
  const section = document.createElement('div')
  section.style.setProperty('--dsh-workspace-indent', '0px')
  section.appendChild(buildRow({ id: spec.id, label: spec.label, expanded: spec.expanded }))
  for (const session of spec.sessions) section.appendChild(buildSessionRow(session))
  sidebar.appendChild(section)
}

groupFor({
  id: 'ws-1',
  label: 'wanderisland',
  expanded: true,
  sessions: [
    { id: 's1', title: '修复登录重试把 token 冲掉的问题', time: '刚刚', state: 'ongoing' },
    { id: 's2', title: '重构权限校验中间件', time: '待审批', state: 'warning' },
    { id: 's3', title: '更新 README 的安装步骤', time: '5分钟前', state: 'done' },
    { id: 's4', title: '整理发布检查清单', time: '2小时前', state: 'idle' },
    { id: 's5', title: '和 api 仓库对齐接口命名', time: '昨天', state: 'idle' },
  ],
})
groupFor({ id: 'ws-2', label: 'api', expanded: false, sessions: [] })

const now = Date.now()
const byId = {
  s1: { id: 's1', title: '修复登录重试把 token 冲掉的问题', updatedAt: now - 30000, running: true },
  s2: { id: 's2', title: '重构权限校验中间件', updatedAt: now - 120000 },
  s3: { id: 's3', title: '更新 README 的安装步骤', updatedAt: now - 300000 },
  s4: { id: 's4', title: '整理发布检查清单', updatedAt: now - 7200000 },
  s5: { id: 's5', title: '和 api 仓库对齐接口命名', updatedAt: now - 86400000 },
}
const statuses = new Map([
  ['s1', { running: true }],
  ['s2', { pendingInteraction: { kind: 'approval' } }],
  ['s3', { completionUnread: true }],
  ['s4', { running: false }],
  ['s5', { running: false }],
])
const sessionsService = {
  list: {
    getSnapshot: () => ({ phase: 'ready', ids: ['s1', 's2', 's3', 's4', 's5'], byId, projectionsBySession: {} }),
    subscribe: () => () => {},
  },
}
const workspacesService = {
  list: {
    getSnapshot: () => ({
      phase: 'ready',
      items: [
        { workspaceId: 'ws-1', path: 'D:\\projects\\wanderisland', title: 'wanderisland', sessionIds: ['s1', 's2', 's3', 's4', 's5'] },
        { workspaceId: 'ws-2', path: 'D:\\projects\\api', title: 'api', sessionIds: [] },
      ],
      archivedSessionIds: [],
    }),
    subscribe: () => () => {},
  },
}
const uiSession = {
  sessionStatus: { getSnapshot: () => statuses, subscribe: () => () => {} },
}

window.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {
      ok: true,
      registryAvailable: true,
      settings: {
        defaultWorkspaceEnabled: false,
        workspaceEnabled: {},
        sortWorkspacesByRecent: true,
        showActiveSessionsWhenCollapsed: true,
      },
      defaultWorkspaceId: 'ws-1',
      defaultWorkspacePath: 'D:\\projects\\wanderisland',
      workspaces: [
        { id: 'ws-1', key: 'd:\\projects\\wanderisland', path: 'D:\\projects\\wanderisland', enabled: true, dirs: [] },
        { id: 'ws-2', key: 'd:\\projects\\api', path: 'D:\\projects\\api', enabled: true, dirs: [] },
      ],
    }
  },
})

const plugin = window.__materializePlugin({
  react: sandbox.React,
  '@deepseek-ai/dsh-client-ui-primitives': sandbox.primitives,
})

const ctx = {
  effect(fn) {
    const dispose = fn()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  inject(_deps, callback) {
    const scope = {
      effect(fn) {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      uiWorkspace: { openSession() {} },
      sessions: sessionsService,
      workspaces: workspacesService,
      inputTriggers: { registerSource: () => () => {} },
    }
    const dispose = callback(scope)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  get(name) {
    return name === 'uiSession' ? uiSession : null
  },
  slots: {
    inject(_name, callback) {
      callback()
      return () => {}
    },
    register() {
      return () => {}
    },
  },
  logger: console,
}

try {
  plugin.apply(ctx)
} catch (error) {
  const note = document.createElement('pre')
  note.style.color = '#f25a5a'
  note.textContent = 'apply failed: ' + String((error && error.stack) || error)
  document.body.appendChild(note)
}

// Fold the first folder exactly the way a reader would; ?unfold=1 then
// folds it back by clicking again, so the second state can be checked too.
const params = new URLSearchParams(location.search)
const folderRow = sidebar.querySelector('[data-row-key="workspace:ws-1"]')
if (folderRow !== null) {
  folderRow.click()
  if (params.get('unfold') === '1') folderRow.click()
}

window.__previewFolded = () => ({
  folded: document.querySelectorAll('.dsh-workspace-plus-folded').length,
  visible: Array.from(document.querySelectorAll('[data-row-key^="session:"]'))
    .filter((row) => row.offsetParent !== null)
    .map((row) => row.getAttribute('data-row-key')),
})
