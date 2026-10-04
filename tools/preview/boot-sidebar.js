/**
 * Sidebar demo: shows the plugin's row button in its real seat.
 *
 * The row markup below is the shell's own (its class names come from
 * `@deepseek-ai/dsh-client-ui-workspace`'s Rows.module.css, extracted into
 * rows.css). The 「更多」and 「新会话」buttons are React-owned there; here they are
 * plain DOM with the same markup. This plugin's button is NOT created by hand —
 * boot calls the real `installWorkspaceRowButtons()`, so the screenshot shows the
 * actual injection and its seat between the two.
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
/** The shell's folder artwork, same paths the plugin's row button draws. */
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

/** One workspace row, built exactly like the shell's `ProjectRowItem`. */
function buildRow({ id, label, expanded }) {
  const row = document.createElement('div')
  row.className = 'projectRow'
  row.setAttribute('data-row-key', `workspace:${id}`)
  row.setAttribute('role', 'treeitem')

  const folder = document.createElement('span')
  folder.className = 'slot'
  folder.appendChild(svg(FOLDER_CLOSED))
  row.appendChild(folder)

  const chevron = document.createElement('span')
  chevron.className = 'slot'
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
  chevron.style.transform = expanded ? 'rotate(90deg)' : 'none'
  row.appendChild(chevron)

  const text = document.createElement('span')
  text.className = 'projectText'
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = label
  text.appendChild(title)
  row.appendChild(text)

  // The shell's action cluster: 「更多」then 「新会话」, in that order.
  const actions = document.createElement('span')
  actions.className = 'rowActions'
  const more = document.createElement('button')
  more.type = 'button'
  more.className = 'iconButton'
  more.setAttribute('aria-label', '更多')
  more.appendChild(svg(ELLIPSIS, false))
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

const sidebar = document.getElementById('sidebar')
sidebar.appendChild(buildRow({ id: 'ws-1', label: 'wanderisland', expanded: true }))
sidebar.appendChild(buildRow({ id: 'ws-2', label: 'api', expanded: false }))

const plugin = window.__materializePlugin({
  react: sandbox.React,
  '@deepseek-ai/dsh-client-ui-primitives': sandbox.primitives,
})

// `apply()` warms the shared snapshot from the host endpoint; answer it locally.
window.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {
      ok: true,
      settings: { defaultWorkspaceEnabled: false, workspaceEnabled: {} },
      defaultWorkspaceId: 'ws-1',
      defaultWorkspacePath: 'D:\\projects\\wanderisland',
      workspaces: [
        { id: 'ws-1', key: 'd:\\projects\\wanderisland', path: 'D:\\projects\\wanderisland', enabled: true, dirs: [] },
        { id: 'ws-2', key: 'd:\\projects\\api', path: 'D:\\projects\\api', enabled: true, dirs: [] },
      ],
    }
  },
})

try {
  plugin.apply({
    effect(fn) {
      fn()
      return () => {}
    },
    inject(_deps, callback) {
      callback({
        uiWorkspace: null,
        sessions: null,
        inputTriggers: { registerSource: () => () => {} },
        effect() {},
      })
      return () => {}
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
  })
} catch (error) {
  document.title = 'ERROR ' + String((error && error.message) || error)
  document.body.insertAdjacentHTML(
    'beforeend',
    '<pre style="color:#f25a5a;font:12px monospace">' + String(error && error.stack) + '</pre>',
  )
}

document.title = 'ready'
window.__preview = {
  rows: sidebar.querySelectorAll('[data-row-key]').length,
  injected: sidebar.querySelectorAll('.' + plugin.ROW_BUTTON_CLASS).length,
  order: [...sidebar.children].map((row) =>
    [...row.lastElementChild.children]
      .map((child) => child.getAttribute('aria-label') ?? child.className)
      .join(' · '),
  ),
}
