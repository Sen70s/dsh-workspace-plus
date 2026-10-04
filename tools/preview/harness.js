/**
 * Design preview harness for the workspace+ dialog.
 *
 * This is NOT the shipped plugin. It renders the real `lib/client.js` module
 * (the same file the shell loads) with real React 18 from the shell's own
 * dependency tree, plus stand-ins for the three primitives the dialog uses. The
 * stand-ins copy the primitives' markup and use the shell's *own* generated class
 * names, read out of the shipped web bundle, so the shell's real stylesheet
 * applies. The purpose is a pixel check of the dialog's layout, its width, and
 * the badge tooltip — the assertions live in tools/verify.mjs.
 */
;(() => {
const React = window.React
const ReactDOM = window.ReactDOM
const { createElement: h, Fragment } = React

const clsx = (...values) => values.filter(Boolean).join(' ')

// Class names the shell's build generated for the primitives' CSS modules. Vite
// names them `_<block>_<hash>_<line>`, leading underscore included.
const MODAL = {
  root: '_root_17i0t_6',
  mask: '_mask_17i0t_18',
  dialog: '_dialog_17i0t_33',
  content: '_content_17i0t_62',
  header: '_header_17i0t_70',
  title: '_title_17i0t_78',
  close: '_close_17i0t_86',
  description: '_description_17i0t_105',
  body: '_body_17i0t_114',
  footer: '_footer_17i0t_122',
}
const BUTTON = {
  button: '_button_1rv3m_2',
  ghost: '_ghost_1rv3m_45',
  md: '_md_1rv3m_23',
  sm: '_sm_1rv3m_28',
  primary: '_primary_1rv3m_36',
  outline: '_outline_1rv3m_54',
  icon: '_icon_1rv3m_71',
}
const TOOLTIP = { bubble: '_bubble_ugtpz_1', label: '_label_ugtpz_26' }
const SWITCH = { switch: '_switch_15ung_5', thumb: '_thumb_15ung_33' }

/** The primitives' Switch, markup-for-markup. */
function Switch({ checked, onChange, label, disabled = false, title, className }) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    title,
    disabled,
    className: clsx(SWITCH.switch, className),
    onClick: () => {
      onChange(!checked)
    },
    children: h('span', { className: SWITCH.thumb }),
  })
}

const CloseGlyph = () =>
  h(
    'svg',
    {
      width: 14,
      height: 14,
      viewBox: '0 0 16 16',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      strokeWidth: 1,
    },
    h('path', { d: 'M2.5 2.5L13.5 13.5', stroke: 'currentColor' }),
    h('path', { d: 'M13.5 2.5L2.5 13.5', stroke: 'currentColor' }),
  )

function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }) {
  return h(
    'button',
    { type: 'button', className: clsx(BUTTON.button, BUTTON[variant], BUTTON[size], className), ...rest },
    icon != null && h('span', { className: BUTTON.icon }, icon),
    children,
  )
}

function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless }) {
  if (!open) return null
  return ReactDOM.createPortal(
    h(
      'div',
      { className: MODAL.root, role: 'presentation' },
      h('div', { className: MODAL.mask, 'aria-hidden': 'true', onClick: onClose }),
      h(
        'div',
        { tabIndex: -1, className: clsx(MODAL.dialog, className), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        headless
          ? children
          : h(
              Fragment,
              null,
              h(
                'div',
                { className: clsx(MODAL.content, contentClassName) },
                h(
                  'div',
                  { className: MODAL.header },
                  h('h2', { className: MODAL.title }, title),
                  h('button', { type: 'button', className: MODAL.close, 'aria-label': closeLabel, onClick: onClose }, h(CloseGlyph)),
                ),
                description !== undefined && description !== '' && h('p', { className: MODAL.description }, description),
                children !== undefined && h('div', { className: MODAL.body }, children),
              ),
              footer !== undefined && h('div', { className: MODAL.footer }, footer),
            ),
      ),
    ),
    document.body,
  )
}

/** Port of the primitives' Tooltip, with the same bubble markup and placement. */
function Tooltip({ label, side = 'right', delayMs = 0, portal = false, maxWidth, children }) {
  const anchor = React.useRef(null)
  const bubble = React.useRef(null)
  const [pos, setPos] = React.useState(null)
  const timer = React.useRef(null)
  const show = () => {
    const el = anchor.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({
      x: side === 'right' ? r.right + 10 : r.left + r.width / 2,
      top: r.top,
      bottom: r.bottom,
      y: side === 'right' ? (r.top + r.bottom) / 2 : r.top - 8,
    })
  }
  React.useEffect(() => {
    const el = bubble.current
    if (el === null || pos === null) return undefined
    el.style.visibility = 'visible'
    return undefined
  }, [pos])
  const content =
    pos === null
      ? null
      : h(
          'span',
          {
            ref: bubble,
            className: TOOLTIP.bubble,
            'data-side': side,
            'data-portal': portal || undefined,
            role: 'tooltip',
            style: { left: pos.x, top: pos.y, visibility: 'hidden', ...(maxWidth === undefined ? {} : { maxWidth }) },
          },
          label && h('span', { className: TOOLTIP.label }, label),
        )
  const anchorNode = React.cloneElement(children, {
    ref: anchor,
    onMouseEnter: () => {
      if (delayMs <= 0) show()
      else timer.current = setTimeout(show, delayMs)
    },
    onMouseLeave: () => {
      clearTimeout(timer.current)
      setPos(null)
    },
    onFocus: () => show(),
    onBlur: () => setPos(null),
  })
  return h(Fragment, null, anchorNode, portal ? ReactDOM.createPortal(content, document.body) : content)
}

// --- the shell's module loader, and the two modules the plugin may require ---
let factory = null
window.__ModuleLoader__ = {
  load({ id, factory: registered }) {
    if (id === 'dsh-workspace-plus') factory = registered
  },
}

/** The dialog's fixture: one workspace with four labelled directories. */
const FIXTURE = {
  ok: true,
  registryAvailable: true,
  settings: { defaultWorkspaceEnabled: false, workspaceEnabled: {} },
  defaultWorkspaceId: 'ws-1',
  defaultWorkspacePath: 'D:\\projects\\wanderisland',
  workspaces: [
    {
      id: 'ws-1',
      key: 'd:\\projects\\wanderisland',
      title: 'wanderisland',
      path: 'D:\\projects\\wanderisland',
      isDefault: true,
      enabled: true,
      dirs: [
        { label: 'web_frontend', path: 'D:\\projects\\wanderisland\\apps\\web', note: '前端' },
        { label: 'backend_all', path: 'D:\\projects\\api', note: '后端 API' },
        { label: 'docs', path: 'D:\\projects\\wanderisland\\docs' },
        { label: 'admin_frontend', path: 'D:\\plugins\\admin-ui', note: '后台' },
      ],
    },
  ],
}

/** The settings page's fixture: several workspaces, one of them switched off. */
const SETTINGS_FIXTURE = {
  ...FIXTURE,
  settings: { defaultWorkspaceEnabled: false, workspaceEnabled: { 'd:\\projects\\api': false } },
  workspaces: [
    { ...FIXTURE.workspaces[0], enabled: false },
    {
      id: 'ws-2',
      key: 'd:\\projects\\api',
      title: 'api',
      path: 'D:\\projects\\api',
      isDefault: false,
      enabled: false,
      dirs: [],
    },
    {
      id: 'ws-3',
      key: 'd:\\plugins\\admin-ui',
      title: 'admin-ui',
      path: 'D:\\plugins\\admin-ui',
      isDefault: false,
      enabled: true,
      dirs: [],
    },
  ],
}

const picker = {
  // The preview needs the promise the click produced, so a screenshot can wait
  // for the state it triggers.
  lastResult: null,
  pickDirectory() {
    window.__pickerCalls = (window.__pickerCalls ?? 0) + 1
    picker.lastResult = Promise.resolve('D:\\projects\\shared\\infra')
    return picker.lastResult
  },
}

const sandbox = {
  React,
  ReactDOM,
  primitives: { Button, Modal, Switch, Tooltip },
  picker,
  FIXTURE,
  SETTINGS_FIXTURE,
}
window.__previewSandbox = sandbox

/** Materialize the captured plugin factory against a fixed module table. */
window.__materializePlugin = (modules) =>
  factory((specifier) => {
    if (!(specifier in modules)) throw new Error('preview: unexpected require("' + specifier + '")')
    return modules[specifier]
  })
})()
