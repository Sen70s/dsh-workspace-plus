/**
 * dsh-workspace-plus — browser half.
 *
 * This file is the package's `./client` export: a self-contained, factory-form
 * CommonJS bundle registered with the shell's client module loader. The host
 * serves it at `/plugins/dsh-workspace-plus/client.js`; the browser loads the
 * script during boot but only *materializes* it (runs the factory body) when the
 * plugin is first needed, so every side effect here — the injected stylesheet
 * included — happens at materialization time, never at script-parse time.
 *
 * The workspace+ feature — workspace directories, as a DIALOG rather than a page.
 * A DSH workspace keeps its one root directory; this registers N more project
 * folders against it, each with a short label, and the host injects that table
 * into the agent's context on every request — so "改 backend" in conversation
 * resolves to an absolute path instead of a guess.
 *
 * Five workspace+ seats cooperate:
 *
 *   `settings.section`    the `workspace+` settings page. It owns one preference:
 *                         whether the feature runs for the default (first-use)
 *                         Workspace, which is off until the user turns it on
 *                         because that Workspace belongs to the product.
 *
 *   `shell.overlay`       the dialog itself, the same frame-wide layer the
 *                         shell's own workspace Rename/Delete dialogs use (the
 *                         Modal portals to <body>, so the entry owns only the
 *                         open state, not the stack position). It reads as one
 *                         column of bordered field rows — the workspace it is
 *                         locked to, the 「目录」 list, an add row that IS the
 *                         shell's own directory picker, and a footer split
 *                         secondary-left / primary-right. There is no path input
 *                         to type into: `ctx.uiWorkspace.pickDirectory()` is the
 *                         only way a directory gets in, and the label/note row
 *                         only appears once one has been chosen.
 *
 *   workspace row button  the primary trigger. The shell's workspace row menu is
 *                         hardcoded to Rename/Delete with no plugin slot, so the
 *                         trigger is a button this half appends to the row's
 *                         action cluster, located through shell-emitted
 *                         `data-row-key="workspace:<id>"` anchors and kept in
 *                         place by a MutationObserver. Every real workspace row
 *                         carries it; a workspace whose switch is off only draws
 *                         it dimmed, because the dialog is where its labels are
 *                         read and the switch itself lives on the settings page.
 *
 *   `sidebar.panellist`   the fallback trigger, registered only while no row
 *                         button could be installed (a shell whose row DOM
 *                         changed, or a sidebar with no workspaces yet).
 *                         Registering it also requires a `main` key: the shell's
 *                         panel button calls `layout.selectPanel` unconditionally
 *                         and that throws for an unregistered key, so a hint
 *                         panel holds the key and the glyph stops the click from
 *                         ever reaching it.
 *
 *   `@` trigger source    the composer side. Typing `@` in a session offers that
 *                         workspace's labels as their own group; a pick inserts a
 *                         reference chip that serializes to the directory's
 *                         absolute path, so the model receives the path even when
 *                         the injected table is not in context.
 *
 * The 通知 (notice) sub-feature — ported from the dsh-notice plugin, which now
 * ships as the `dsh-workspace-plus/notice` loader row of this same bundle — adds
 * two more seats here, described in detail at its section below:
 *
 *   `settings.section`    the 通知 settings page (same id, label and order the
 *                         standalone plugin used), writing through the same
 *                         `/dsh-notice/api` routes. When the notice row is off
 *                         the host answers 404 and the page explains the state.
 *
 *   the pending poll      the last centimetre of the click-to-open path: toast
 *                         click → `dsh-notice:` protocol → host route → pending
 *                         intent → THIS half → `ctx.uiWorkspace.openSession()`.
 *
 * Only the shell's frozen platform module table may be `require`d here (react,
 * react-dom, react/jsx-runtime, @deepseek-ai/cordis,
 * @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
 * @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit).
 * Any other specifier needs a matching `dsh.client.external` entry in
 * package.json, which this plugin does not use.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-plus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, Modal, Switch } = primitives

    /**
     * The shell's hover tooltip. The dialog's "outside the workspace root" badge
     * says what it means through this rather than through a sentence in the row,
     * so a shell that predates the export degrades to the still-labelled badge
     * instead of crashing the dialog.
     */
    const Tooltip = typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null

    /** Id of the directory-dialog fallback entry, and the main key that backs it. */
    const WORKDIRS_PANEL_ID = 'workdirs'

    /** Sidebar row label of the directory-dialog fallback entry. */
    const WORKDIRS_PANEL_LABEL = 'workdirs'

    /**
     * Position among the global panel rows. The shipped entries use 0 (Plugins)
     * and 10 (Scheduled tasks); 30 keeps this one after them.
     */
    const WORKDIRS_PANEL_ORDER = 30

    /**
     * The settings page. `settings.section` occupants ship at -10 (account),
     * 0 (general), 10 (models), 15 (plugins) and 20 (agent presets); 25 puts
     * `workspace+` at the end of the product sections and before nothing else.
     */
    const SETTINGS_SECTION_ID = 'workspaceplus'
    const SETTINGS_SECTION_LABEL = 'workspace+'
    const SETTINGS_SECTION_ORDER = 25

    /**
     * Settings keys this page owns.
     *
     * `WORKSPACE_ENABLED_SETTING` is the per-workspace layer the settings page
     * actually writes: one switch per workspace, keyed by the workspace key the
     * host publishes in its snapshot. `DEFAULT_WORKSPACE_SETTING` is the default
     * that layer falls back to for the default Workspace, and is read only.
     */
    const DEFAULT_WORKSPACE_SETTING = 'defaultWorkspaceEnabled'
    const WORKSPACE_ENABLED_SETTING = 'workspaceEnabled'

    /** Host JSON endpoint, resolved against the page so it survives any mount path. */
    const API_PATH = 'workspaceplus/api'

    // -----------------------------------------------------------------------
    // The 通知 (notice) sub-feature — client side
    //
    // The notice host half (`lib/notice/index.js`, the `dsh-workspace-plus/notice`
    // loader row) owns the Windows transport and three HTTP routes. This half
    // contributes the two browser-side pieces the dsh-notice plugin used to ship
    // in its own client bundle:
    //
    //   the 通知 settings page — same slot (`settings.section`), same id, same
    //   order, writing through the SAME routes as before (`/dsh-notice/api`).
    //   When the notice row is disabled the host answers 404, the page renders
    //   that state, and nothing else in this bundle is affected.
    //
    //   the pending-open poll — the last centimetre of the click-to-open path:
    //   toast click → protocol → host route → pending intent → THIS half →
    //   ctx.uiWorkspace.openSession(). The poll is unconditionally cheap (one
    //   404-tolerant GET every 4 s) and is what makes clicking a notification
    //   open the conversation; it stays on even when the settings page cannot
    //   load, because a notification may outlive a row toggle.
    //
    // Route paths and the settings-page identity are kept byte-identical to
    // dsh-notice 0.2.1, so an in-place upgrade preserves the protocol scheme,
    // the registry command and every stored override.
    // -----------------------------------------------------------------------

    /** Settings section identity of the 通知 page (unchanged from dsh-notice). */
    const NOTICE_SETTINGS_SECTION_ID = 'notice'
    const NOTICE_SETTINGS_SECTION_LABEL = '通知'
    const NOTICE_SETTINGS_SECTION_ORDER = 26

    /** Host routes the notice half talks to; must match lib/notice/index.js. */
    const NOTICE_API_PATH = '/dsh-notice/api'
    const NOTICE_PENDING_PATH = '/dsh-notice/api/pending'

    /** Backstop poll interval, and the retry interval after a failed poll. */
    const NOTICE_POLL_INTERVAL_MS = 4000
    const NOTICE_POLL_RETRY_MS = 2000

    /** Stylesheet identity for the 通知 settings page (one tag, rewritten on reload). */
    const NOTICE_STYLE_ID = 'dsh-workspace-plus/notice.css'

    /** Prefix for every class the notice page injects, so it can never collide. */
    const NOTICE_CSS = `
.dsh-notice-section { display: flex; flex-direction: column; gap: 14px; }
.dsh-notice-group { display: flex; flex-direction: column; gap: 10px; }
.dsh-notice-group-title { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.dsh-notice-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-notice-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-notice-title { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
.dsh-notice-desc { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.5; }
.dsh-notice-switch { position: relative; flex: none; width: 38px; height: 22px; margin-top: 2px; padding: 0; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-2); transition: background .15s ease, border-color .15s ease; }
.dsh-notice-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-notice-switch:disabled { cursor: default; opacity: .5; }
.dsh-notice-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform .15s ease; }
.dsh-notice-switch[aria-checked="true"] .dsh-notice-knob { transform: translateX(16px); }
.dsh-notice-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-notice-button { cursor: pointer; padding: 5px 12px; font-size: 13px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-notice-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l1); }
.dsh-notice-button:disabled { cursor: default; opacity: .5; }
.dsh-notice-status { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.6; }
.dsh-notice-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
.dsh-notice-error { color: var(--dsw-alias-state-error-primary); }
.dsh-notice-ok { color: var(--dsw-alias-state-success-primary); }
`

    /** Install the notice stylesheet, exactly one tag per document (rewritten on reload). */
    function ensureNoticeStyles() {
      if (typeof document === 'undefined') return
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(NOTICE_STYLE_ID) + ']')
      if (existing !== null) {
        existing.textContent = NOTICE_CSS
        return
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-plus'
      tag.dataset.pluginCss = NOTICE_STYLE_ID
      tag.textContent = NOTICE_CSS
      document.head.appendChild(tag)
    }

    /**
     * Fetch the notice host's snapshot.
     *
     * @param origin - the origin this page was served from, reported once so the
     *   host can learn its own listen port and register the protocol against it.
     * @param signal - caller cancellation.
     * @returns the parsed payload.
     */
    async function fetchNoticeSnapshot(origin, signal) {
      const query = origin === null ? '' : `?origin=${encodeURIComponent(origin)}`
      const response = await fetch(`${NOTICE_API_PATH}${query}`, { cache: 'no-store', signal })
      if (!response.ok) throw new Error(`host responded ${response.status}`)
      return await response.json()
    }

    /**
     * Post one notice control operation.
     *
     * @param body - operation payload.
     * @returns the parsed payload.
     */
    async function postNoticeOperation(body) {
      const response = await fetch(NOTICE_API_PATH, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`host responded ${response.status}`)
      return await response.json()
    }

    /**
     * One labelled switch row of the 通知 page.
     *
     * @param props - `{ title, description, checked, disabled, onChange }`.
     * @returns the row element.
     */
    function NoticeSwitchRow(props) {
      return React.createElement(
        'div',
        { className: 'dsh-notice-row' },
        React.createElement(
          'div',
          { className: 'dsh-notice-text' },
          React.createElement('div', { className: 'dsh-notice-title' }, props.title),
          props.description ? React.createElement('div', { className: 'dsh-notice-desc' }, props.description) : null,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': props.checked === true,
            'aria-label': props.title,
            disabled: props.disabled === true,
            className: 'dsh-notice-switch',
            onClick: () => props.onChange(props.checked !== true),
          },
          React.createElement('span', { className: 'dsh-notice-knob' }),
        ),
      )
    }

    /**
     * The 通知 settings page (the same page the dsh-notice plugin registered,
     * now riding in this bundle). Every switch writes immediately; the host
     * answers with a fresh snapshot, so the page never predicts what was
     * accepted. A 404 — the notice row being disabled — renders as an
     * explanation instead of an error, because that state is a choice, not a
     * breakage.
     *
     * @returns the settings section element.
     */
    function NoticeSettings() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: 'loading', message: '' })
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
        ;(async () => {
          try {
            const payload = await fetchNoticeSnapshot(null, controller?.signal)
            if (cancelled) return
            setSnapshot(payload)
            setStatus({ kind: 'ready', message: '' })
          } catch (error) {
            if (cancelled) return
            setStatus({ kind: 'error', message: String((error && error.message) || error) })
          }
        })()
        return () => {
          cancelled = true
          controller?.abort()
        }
      }, [])

      const send = React.useCallback(async (body) => {
        setBusy(true)
        try {
          const payload = await postNoticeOperation(body)
          // A rejected operation answers with a message and no snapshot (an
          // unknown op, a body that is not JSON). Adopting that as state would
          // blank the page, so it only updates the status line.
          if (payload !== null && typeof payload === 'object' && payload.settings !== undefined) {
            setSnapshot(payload)
          }
          setStatus({
            kind: payload !== null && payload.ok === true ? 'ready' : 'error',
            message: String(payload?.message ?? ''),
          })
        } catch (error) {
          setStatus({ kind: 'error', message: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }, [])

      if (snapshot === null) {
        const message = status.kind === 'error' ? status.message : ''
        // `host responded 404` is the notice ROW being switched off on the
        // plugin page — a deliberate state, worded as one rather than as a
        // failure. Any other message is a genuine transport error.
        if (status.kind === 'error' && message.includes('404')) {
          return React.createElement(
            'div',
            { className: 'dsh-notice-section' },
            React.createElement(
              'div',
              { className: 'dsh-notice-desc' },
              '通知子功能当前未启用：在侧栏「插件」页的 dsh-workspace-plus 卡片里打开 notice 这一行即可开启。',
            ),
          )
        }
        return React.createElement(
          'div',
          { className: 'dsh-notice-section' },
          React.createElement(
            'div',
            { className: 'dsh-notice-desc' },
            status.kind === 'error' ? `读取设置失败：${message}` : '正在读取设置…',
          ),
        )
      }

      const settings = snapshot.settings ?? {}
      const kinds = Array.isArray(snapshot.kinds) ? snapshot.kinds : []
      const toast = snapshot.toast ?? {}
      const protocol = snapshot.protocol ?? {}
      const disabled = busy || settings.enabled !== true

      const kindRows = kinds.map((kind) =>
        React.createElement(NoticeSwitchRow, {
          key: kind.id,
          title: kind.label,
          checked: kind.enabled === true,
          disabled,
          onChange: (next) => void send({ op: 'patch', patch: { kinds: { [kind.id]: next } } }),
        }),
      )

      const transportLine = (() => {
        if (snapshot.platformSupported !== true) return '当前平台不是 Windows，通知不会显示。'
        // The daemon starts with the first notification, so "not running yet" is
        // the ordinary state right after loading the plugin, not a fault.
        if (toast.running !== true && toast.started !== true) {
          return 'toast 守护进程尚未启动，将在第一条通知到来时自动启动。'
        }
        if (toast.running !== true) return 'toast 守护进程未运行，下一条通知会自动重新启动它。'
        return `toast 守护进程运行中，以 ${
          toast.appIdConfigured === true ? '指定' : '自动'
        } AUMID 发言：${toast.appId ?? '(未知)'}`
      })()

      const protocolLine = (() => {
        if (protocol.registered === true) return `点击通知可打开对应对话（已注册 ${protocol.scheme}:）。`
        if (settings.registerProtocol === false) return '已关闭协议注册：点击通知只会把 Harness 窗口切到前台。'
        return `尚未注册 ${protocol.scheme ?? 'dsh-notice'}:，点击通知只会把 Harness 窗口切到前台。`
      })()

      return React.createElement(
        'div',
        { className: 'dsh-notice-section' },
        React.createElement(
          'div',
          { className: 'dsh-notice-group' },
          React.createElement(NoticeSwitchRow, {
            title: '启用桌面通知',
            description: '对话需要你时，弹出 Windows 原生通知；点击通知可打开对应的对话。',
            checked: settings.enabled === true,
            disabled: busy,
            onChange: (next) => void send({ op: 'patch', patch: { enabled: next } }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-notice-group' },
          React.createElement('div', { className: 'dsh-notice-group-title' }, '通知类型'),
          ...kindRows,
        ),
        React.createElement(
          'div',
          { className: 'dsh-notice-group' },
          React.createElement('div', { className: 'dsh-notice-group-title' }, '行为'),
          React.createElement(NoticeSwitchRow, {
            title: '只通知主对话',
            description: '关闭后，子代理与团队成员的每一轮结束也会通知（通常非常密集）。',
            checked: settings.scope === 'roots',
            disabled,
            onChange: (next) => void send({ op: 'patch', patch: { scope: next ? 'roots' : 'all' } }),
          }),
          React.createElement(NoticeSwitchRow, {
            title: '通知声音',
            description: '关闭后通知静音出现，仍然进入 Windows 通知中心。',
            checked: settings.sound === true,
            disabled,
            onChange: (next) => void send({ op: 'patch', patch: { sound: next } }),
          }),
          React.createElement(NoticeSwitchRow, {
            title: '点击时把 Harness 窗口切到前台',
            description: '关闭后只切换对话，不改变窗口的前后顺序。',
            checked: settings.focusOnClick === true,
            disabled,
            onChange: (next) => void send({ op: 'patch', patch: { focusOnClick: next } }),
          }),
          React.createElement(NoticeSwitchRow, {
            title: '注册 dsh-notice: 协议',
            description:
              '在当前用户注册表下注册协议，让点击通知能定位到具体对话。关闭则退化为只切前台，不写注册表。',
            checked: settings.registerProtocol === true,
            disabled,
            onChange: (next) => void send({ op: 'patch', patch: { registerProtocol: next } }),
          }),
          React.createElement(
            'div',
            { className: 'dsh-notice-row' },
            React.createElement(
              'div',
              { className: 'dsh-notice-text' },
              React.createElement('div', { className: 'dsh-notice-title' }, '通知显示时长'),
              React.createElement(
                'div',
                { className: 'dsh-notice-desc' },
                settings.duration === 'long' ? '当前：长（约 25 秒）' : '当前：短（约 5 秒）',
              ),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-notice-button',
                disabled,
                onClick: () => void send({ op: 'patch', patch: { duration: settings.duration === 'long' ? 'short' : 'long' } }),
              },
              settings.duration === 'long' ? '改为短' : '改为长',
            ),
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-notice-actions' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-notice-button',
              disabled: busy,
              onClick: () => void send({ op: 'test' }),
            },
            '发送测试通知',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-notice-button',
              disabled: busy || Object.keys(snapshot.overrides ?? {}).length === 0,
              onClick: () => void send({ op: 'clear' }),
            },
            '恢复默认',
          ),
        ),
        React.createElement(
          'div',
          { className: 'dsh-notice-status' },
          React.createElement('div', null, transportLine),
          React.createElement('div', null, protocolLine),
          toast.lastError
            ? React.createElement('div', { className: 'dsh-notice-mono dsh-notice-error' }, String(toast.lastError))
            : null,
          status.message
            ? React.createElement(
                'div',
                { className: status.kind === 'error' ? 'dsh-notice-error' : 'dsh-notice-ok' },
                status.message,
              )
            : null,
        ),
      )
    }

    /**
     * Poll the notice host for a pending "open this conversation" intent.
     *
     * A click on a notification focuses the desktop window; the focus event
     * triggers an immediate poll, so the conversation usually opens on the same
     * frame the window appears. The timer is only the backstop for a click that
     * arrives while the window already has focus. A 404 (notice row disabled)
     * and a network failure are both silent: this poll must never become
     * noticeable, and it must never take the workspace+ features down.
     *
     * @param ctx - the plugin's client context.
     * @returns a disposer stopping every timer, listener and request in flight.
     */
    function startNoticePendingPoll(ctx) {
      let stopped = false
      let timer = null
      let inFlight = false
      const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()

      const openSession = (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        let workspace = null
        try {
          workspace = ctx.get('uiWorkspace')
        } catch {
          return
        }
        if (workspace === undefined || workspace === null || typeof workspace.openSession !== 'function') return
        try {
          workspace.openSession(sessionId)
        } catch {
          // An archived or unknown conversation cannot be selected; the click
          // still brought the window forward, which is the useful half.
        }
      }

      const schedule = (delay) => {
        if (stopped) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => void tick(), delay)
      }

      const tick = async () => {
        if (stopped || inFlight) return
        inFlight = true
        let delay = NOTICE_POLL_INTERVAL_MS
        try {
          const response = await fetch(`${NOTICE_PENDING_PATH}?_=${Date.now()}`, {
            cache: 'no-store',
            signal: controller?.signal,
          })
          if (response.ok) {
            const payload = await response.json()
            if (payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string') {
              openSession(payload.sessionId)
            }
          } else {
            delay = NOTICE_POLL_RETRY_MS
          }
        } catch {
          delay = NOTICE_POLL_RETRY_MS
        } finally {
          inFlight = false
        }
        schedule(delay)
      }

      // A click on a notification focuses the desktop window, and that focus
      // event is what makes the conversation open immediately rather than up to
      // one poll interval later.
      const onFocus = () => schedule(0)
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onFocus)

      // Report the origin once, so the host learns the port it is listening on
      // and can point the protocol registration at it. The settings page loads
      // lazily, so this one early GET is also the only thing that wakes the
      // host's protocol sync when the user never opens 设置 → 通知.
      void fetchNoticeSnapshot(window.location.origin, controller?.signal).catch(() => {})
      void tick()

      return () => {
        stopped = true
        if (timer !== null) clearTimeout(timer)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onFocus)
        controller?.abort()
      }
    }

    /**
     * Run one notice registration, reporting a failure instead of throwing it.
     *
     * The shell treats a non-ACTIVE client entry as a fatal boot error, so an
     * exception here would take the whole application down with it. The failure
     * is still surfaced — through the shell's logger — but the fiber stays
     * active and the workspace+ features keep working.
     *
     * @param ctx - the plugin's client context.
     * @param subject - what was being registered, named in the message.
     * @param setup - the registration body.
     * @returns nothing.
     */
    function registerNotice(ctx, subject, setup) {
      try {
        setup()
      } catch (error) {
        const message = String((error && error.message) || error)
        try {
          ctx.logger?.warn?.(`[dsh-workspace-plus/notice] ${subject}注册失败，已跳过：${message}`)
        } catch {
          // A logger that cannot log must not turn a skipped registration back
          // into the boot failure this boundary exists to prevent.
        }
      }
    }

    /** Identity of the injected stylesheet, used to keep exactly one copy. */
    const STYLE_ID = 'dsh-workspace-plus/panel.css'

    /**
     * Row anchors. The shell emits `data-slot="<slot key>"` on every slot outlet
     * and `data-row-key="workspace:<workspaceId>"` on a workspace group row, and
     * a row's last element child is its action cluster.
     */
    const SIDEBAR_SLOT_SELECTOR = '[data-slot="sidebar.workspaces"]'
    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const ROW_KEY_PREFIX = 'workspace:'

    /** Class of the button this half appends to a workspace row. */
    const ROW_BUTTON_CLASS = 'dsh-workspace-plus-rowbtn'

    /**
     * Class marking that same button on a workspace the settings page switched
     * off. The button stays — the dialog is the only place a workspace's labels
     * can be read — but it draws dimmed and says why in its tooltip.
     */
    const ROW_BUTTON_OFF_CLASS = 'dsh-workspace-plus-rowbtn-off'

    /** Label of the injected row button. */
    const ROW_BUTTON_LABEL = '工作区目录设置'

    /** Label of that button where workspace+ is switched off for the workspace. */
    const ROW_BUTTON_LABEL_OFF = '工作区目录设置（这个工作区已在 workspace+ 里停用）'

    /**
     * The shell's own folder-open artwork, copied verbatim from
     * `@deepseek-ai/dsh-client-ui-primitives` (`IconFolderOpenArtwork`). It is
     * static path data rather than a runtime import, so the injected button is
     * pixel-identical to the row icons the shell draws beside it without adding a
     * dependency on an icon export name.
     */
    const FOLDER_ARTWORK = [
      {
        d: 'M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z',
        opacity: '0.16',
      },
      {
        d: 'M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z',
      },
      {
        d: 'M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z',
      },
    ]

    /** Glyph of the injected row button, built from the official artwork above. */
    const ROW_BUTTON_GLYPH =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true" focusable="false">' +
      FOLDER_ARTWORK.map(
        (path) => `<path d="${path.d}" fill="currentColor"${path.opacity === undefined ? '' : ` opacity="${path.opacity}"`}/>`,
      ).join('') +
      '</svg>'

    /**
     * The shell's shield contour, copied verbatim from
     * `@deepseek-ai/dsh-client-ui-primitives` (`SHIELD_OUTLINE_PATH`, the artwork
     * behind `IconShieldOutlineRegular`). Same reasoning as the folder artwork
     * above: the badge is the product's own warning shape without depending on an
     * export name. It strokes with `currentColor`, so the row picks the color (the
     * theme's warn token) rather than the artwork.
     */
    const SHIELD_PATH =
      'M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 ' +
      '10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z'

    /**
     * Two more official glyphs, same provenance as the folder artwork above and
     * for the same reason: the dialog's row actions and its add row should read as
     * the shell's own icons without depending on an export name.
     *
     *   CLOSE_ARTWORK  `IconCloseOutline16` (`ic_ds_close_outline_16`) — the row's
     *                  remove control, the same cross the shell puts in a dialog's
     *                  top-right corner.
     *   PLUS_ARTWORK   `IconPlusOutline16` (`ic_ds_plus_outline_16`) — the add row.
     *                  It is deliberately not a folder: the row's folder glyphs
     *                  belong to registered directories, and a second folder would
     *                  make the add row read as one of them.
     */
    const CLOSE_ARTWORK = [
      'M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z',
      'M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z',
    ]
    const PLUS_ARTWORK = ['M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z']

    /**
     * How long the fallback entry waits before deciding that no workspace-row
     * button can exist, so a healthy shell never flashes it.
     */
    const FALLBACK_SETTLE_MS = 1200

    /**
     * Panel styles. Everything is namespaced under `dsh-workspace-plus-` and
     * colored through the shell's theme tokens, so the surfaces follow the active
     * light/dark theme instead of hard-coding colors. Fallbacks after each token
     * keep them readable on a shell that predates a given token.
     */
    const CSS = `
.dsh-workspace-plus-panel{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:1 1 auto;height:100%;min-height:0;padding:32px 24px;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dsh-workspace-plus-card{box-sizing:border-box;width:min(520px,100%);display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 32px 30px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);text-align:center;animation:dsh-workspace-plus-in .18s var(--ds-ease-in-out,ease-out) both}
.dsh-workspace-plus-badge{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-workspace-plus-glyph{display:block}
.dsh-workspace-plus-title{margin:0;font-size:24px;font-weight:600;letter-spacing:.2px}
.dsh-workspace-plus-subtitle{margin:0;max-width:42ch;color:var(--dsw-alias-label-secondary)}
.dsh-workspace-plus-actions{display:flex;align-items:center;gap:12px;margin-top:6px}
.dsh-workspace-plus-settings{flex-direction:column;width:100%;display:flex}
.dsh-workspace-plus-settings-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}
.dsh-workspace-plus-settings-text{min-width:0}
.dsh-workspace-plus-settings-title{font-size:14px;line-height:20px}
.dsh-workspace-plus-settings-tag{margin-left:8px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;vertical-align:1px}
.dsh-workspace-plus-settings-description{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.dsh-workspace-plus-settings-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsh-workspace-plus-settings-ok{color:var(--dsw-alias-state-success-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsh-workspace-plus-rowbtn{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;flex:none;cursor:pointer;border-radius:var(--dsw-radius-xs,4px);background:0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-rowbtn:hover{color:var(--dsw-alias-label-primary)}
.dsh-workspace-plus-rowbtn-off{opacity:.55}
.dsh-workspace-plus-rowbtn-off:hover{opacity:1;color:var(--dsw-alias-label-primary)}
.dsh-workspace-plus-rowbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.dsh-workspace-plus-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsh-workspace-plus-dialog-card.dsh-workspace-plus-dialog-card{width:min(640px,100%)}
.dsh-workspace-plus-field{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1)}
.dsh-workspace-plus-field-glyph{display:inline-flex;flex:none;align-items:center;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-field-title{flex:none;min-width:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dsh-workspace-plus-field-root{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-section{margin:0 2px -6px;color:var(--dsw-alias-label-secondary)}
.dsh-workspace-plus-list{box-sizing:border-box;width:100%;max-height:34vh;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1)}
.dsh-workspace-plus-row,.dsh-workspace-plus-field-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-workspace-plus-row:first-child,.dsh-workspace-plus-field-row:first-child{border-top:none}
.dsh-workspace-plus-row-tag{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dsh-workspace-plus-row-path{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-row-note{flex:0 1 auto;max-width:16ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dsh-workspace-plus-row-outside{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-state-warn-primary)}
.dsh-workspace-plus-row-outside:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px;border-radius:var(--dsw-radius-xs,4px)}
.dsh-workspace-plus-remove{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-workspace-plus-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-workspace-plus-remove:disabled{cursor:not-allowed;opacity:.4}
.dsh-workspace-plus-remove:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.dsh-workspace-plus-add{width:100%;font:inherit;text-align:left;color:var(--dsw-alias-label-secondary);background:0 0;border-right:none;border-bottom:none;border-left:none;cursor:pointer}
.dsh-workspace-plus-add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-workspace-plus-add:disabled{cursor:not-allowed;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-add:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.dsh-workspace-plus-add-text{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-workspace-plus-add-path{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px}
.dsh-workspace-plus-select{min-width:0;flex:1 1 auto;font:inherit;color:var(--dsw-alias-label-primary);background:0 0;border:none;padding:0}
/* The light theme resolves bg-layer-1/2/3 to the same white, so a borderless
   input filled with a layer token disappears inside its group there. The
   interactive fills are the one neutral surface pair that reads in both themes:
   6%/10% of the label colour in light, 8%/14% of it in dark. */
.dsh-workspace-plus-input{box-sizing:border-box;min-width:0;height:34px;padding:0 10px;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:var(--dsw-radius-sm,8px)}
.dsh-workspace-plus-input:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dsh-workspace-plus-input:disabled{background:0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-plus-select:focus-visible,.dsh-workspace-plus-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
.dsh-workspace-plus-input-label{flex:0 1 180px}
.dsh-workspace-plus-input-note{flex:1 1 auto}
.dsh-workspace-plus-submit{flex:none}
.dsh-workspace-plus-empty{color:var(--dsw-alias-label-secondary)}
.dsh-workspace-plus-notice{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1)}
.dsh-workspace-plus-notice-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-1))}
.dsh-workspace-plus-notice-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,var(--dsw-alias-bg-layer-1))}
.dsh-workspace-plus-status{font-size:14px;line-height:22px}
.dsh-workspace-plus-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%}
.dsh-workspace-plus-note{color:var(--dsw-alias-label-secondary)}
.dsh-workspace-plus-off{color:var(--dsw-alias-state-warn-primary)}
.dsh-workspace-plus-error{color:var(--dsw-alias-state-error-primary)}
.dsh-workspace-plus-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-workspace-plus-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);word-break:break-all}
@keyframes dsh-workspace-plus-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-workspace-plus-card{animation:none}}
`

    /**
     * Install the panel stylesheet, exactly one tag per document. The factory body
     * runs at materialization, and a client-module reload re-runs it inside the
     * page that is already open: rewriting the existing tag (rather than skipping
     * when one is present) keeps the count at one AND keeps it current, so a
     * stylesheet edit never pairs the new markup with the previous CSS. The
     * `data-plugin-css` marker is what finds that tag again.
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']')
      if (existing !== null) {
        existing.textContent = CSS
        return
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-plus'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    ensureStyles()

    // The notice page's stylesheet follows the same one-tag rule; calling it in
    // the factory body (like the panel sheet above) means the 通知 page needs no
    // `<style>` element of its own and reloads stay duplicate-free.
    ensureNoticeStyles()

    // -----------------------------------------------------------------------
    // The workspace-directory feature
    // -----------------------------------------------------------------------

    /**
     * One glyph built from inlined official artwork. Entries are either a bare
     * path string or `{ d, opacity }`, so the folder's translucent underlay and
     * the flat single-path icons share one renderer.
     *
     * @param props - the artwork to draw, its size, an optional class, and the
     *   click handler when the glyph is itself a control.
     * @returns the icon element.
     */
    function ArtworkGlyph({ artwork, size = 16, className = 'dsh-workspace-plus-glyph', onClick }) {
      return React.createElement(
        'svg',
        {
          className,
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          ...(onClick === undefined ? {} : { onClick }),
        },
        artwork.map((entry, index) => {
          const path = typeof entry === 'string' ? { d: entry } : entry
          return React.createElement('path', {
            key: index,
            d: path.d,
            fill: 'currentColor',
            ...(path.opacity === undefined ? {} : { opacity: path.opacity }),
          })
        }),
      )
    }

    /**
     * The folder-open artwork as an element, so the fallback sidebar entry, the
     * hint panel, and the dialog's directory rows all draw the same icon the
     * shell uses on its workspace row.
     *
     * @param props - optional size, free-form class, and the click handler when
     *   the glyph is itself a control.
     * @returns the icon element.
     */
    function FolderGlyph({ size = 16, className, onClick }) {
      return React.createElement(ArtworkGlyph, { artwork: FOLDER_ARTWORK, size, className, onClick })
    }

    /** The row's remove control: the shell's cross. */
    function CloseGlyph({ size = 16 }) {
      return React.createElement(ArtworkGlyph, { artwork: CLOSE_ARTWORK, size })
    }

    /** The add row's leading glyph: the shell's plus. */
    function PlusGlyph({ size = 16 }) {
      return React.createElement(ArtworkGlyph, { artwork: PLUS_ARTWORK, size })
    }


    /**
     * The directory glyph, shared by the fallback sidebar entry and the hint
     * panel. It draws the same official artwork as the injected row button, so
     * every entry point to this feature looks like the shell's own icons.
     *
     * @param props - sidebar icon share, plus the optional click handler.
     * @returns the icon element.
     */
    function WorkdirsPanelIcon({ size = 16, onClick }) {
      return React.createElement(FolderGlyph, { size, onClick })
    }

    /**
     * The fallback entry's glyph. Its click is stopped before the shell's panel
     * button sees it, so the sidebar row opens the dialog instead of switching
     * `main`; the hint panel behind that key is what a user sees if this ever
     * stops working.
     *
     * @param props - sidebar icon share.
     * @returns the icon element.
     */
    function WorkdirsEntryIcon(props) {
      return WorkdirsPanelIcon({
        ...props,
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          openWorkdirsDialog(null)
        },
      })
    }

    /**
     * Bundle-local open state for the dialog. Its two triggers live in different
     * React trees from the dialog (one is not React at all), so they meet on this
     * tiny external store rather than on a shared parent.
     */
    let dialogSnapshot = { open: false, workspaceId: null }
    const dialogListeners = new Set()

    /** @returns the current dialog snapshot (referentially stable until it changes). */
    function readDialog() {
      return dialogSnapshot
    }

    /**
     * Subscribe to dialog open-state changes.
     *
     * @param listener - called after each change.
     * @returns the unsubscribe function.
     */
    function subscribeDialog(listener) {
      dialogListeners.add(listener)
      return () => {
        dialogListeners.delete(listener)
      }
    }

    /**
     * Replace the dialog snapshot and notify subscribers.
     *
     * @param next - the next `{ open, workspaceId }`.
     */
    function writeDialog(next) {
      const previous = dialogSnapshot
      if (previous.open === next.open && previous.workspaceId === next.workspaceId) return
      dialogSnapshot = next
      for (const listener of [...dialogListeners]) listener()
    }

    /**
     * Open the dialog, optionally focused on one workspace.
     *
     * @param workspaceId - the workspace to preselect, or null to keep the current one.
     */
    function openWorkdirsDialog(workspaceId = null) {
      writeDialog({ open: true, workspaceId })
    }

    /** Close the dialog. */
    function closeWorkdirsDialog() {
      writeDialog({ open: false, workspaceId: null })
    }

    /** The dialog's state before the first host response arrives. */
    const WORKDIRS_IDLE = {
      status: 'loading',
      message: '',
      ok: null,
      registryAvailable: true,
      workspaces: [],
      selected: null,
      locked: false,
      busy: false,
    }

    /**
     * Resolve the host endpoint against the page, so the same code works under a
     * root mount, under a nested mount, and under the desktop shell's
     * `dsh-app://app/` origin (which forwards every non-asset path to the Host).
     *
     * @returns the resolved endpoint URL.
     */
    function apiUrl() {
      if (typeof document === 'undefined') return API_PATH
      try {
        return new URL(API_PATH, document.baseURI).toString()
      } catch {
        return API_PATH
      }
    }

    /**
     * Read the workspace list plus every registered directory from the host.
     *
     * @param signal - optional abort signal.
     * @returns the parsed payload, or `{ ok: false, message }`.
     */
    async function fetchWorkspaces(signal) {
      const response = await fetch(apiUrl(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal,
      })
      if (!response.ok) return { ok: false, message: 'host responded ' + response.status }
      return await response.json()
    }

    /**
     * Send one mutation to the host.
     *
     * @param payload - `{ op, workspace, label, path, note }`.
     * @returns the parsed payload, or `{ ok: false, message }`.
     */
    async function postOperation(payload) {
      const response = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      if (!response.ok) return { ok: false, message: 'host responded ' + response.status }
      return await response.json()
    }

    /**
     * The last host payload this page has seen, shared by the three client
     * surfaces: the settings page renders one switch per workspace from it, the
     * row installer consults the per-workspace `enabled` flag, and the dialog
     * refreshes it after every mutation.
     */
    let hostState = {
      known: false,
      settings: { [DEFAULT_WORKSPACE_SETTING]: false, [WORKSPACE_ENABLED_SETTING]: {} },
      defaultWorkspaceId: null,
      defaultWorkspacePath: null,
      workspaces: [],
    }
    const hostStateListeners = new Set()

    /** @returns the current host snapshot (referentially stable until it changes). */
    function readHostState() {
      return hostState
    }

    /**
     * Subscribe to host-snapshot changes.
     *
     * @param listener - called after each change.
     * @returns the unsubscribe function.
     */
    function subscribeHostState(listener) {
      hostStateListeners.add(listener)
      return () => {
        hostStateListeners.delete(listener)
      }
    }

    /**
     * Fold a host payload into the shared snapshot. Unusable payloads leave the
     * previous snapshot alone.
     *
     * @param payload - a parsed `/workspaceplus/api` response.
     * @returns whether the payload was usable.
     */
    function publishHostPayload(payload) {
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) return false
      const rawOverrides = payload.settings?.[WORKSPACE_ENABLED_SETTING]
      const overrides = {}
      if (rawOverrides !== null && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
        for (const [key, value] of Object.entries(rawOverrides)) {
          if (typeof value === 'boolean') overrides[key] = value
        }
      }
      hostState = {
        known: true,
        settings: {
          [DEFAULT_WORKSPACE_SETTING]: payload.settings?.[DEFAULT_WORKSPACE_SETTING] === true,
          [WORKSPACE_ENABLED_SETTING]: overrides,
        },
        defaultWorkspaceId: typeof payload.defaultWorkspaceId === 'string' ? payload.defaultWorkspaceId : null,
        defaultWorkspacePath: typeof payload.defaultWorkspacePath === 'string' ? payload.defaultWorkspacePath : null,
        workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
      }
      for (const listener of [...hostStateListeners]) listener()
      return true
    }

    /**
     * Whether workspace+ runs for one workspace id.
     *
     * This is the host's own switch (`settings.workspaceEnabled`, with the
     * default Workspace falling back to `defaultWorkspaceSetting`); the host
     * gates prompt-context injection and the `workspace_dirs` tool on it. On the
     * browser side it only chooses how the row button is presented — normal or
     * switched-off — because the button itself is present everywhere. A
     * workspace the snapshot does not know yet counts as enabled: guessing
     * "off" would mislabel a perfectly ordinary row.
     *
     * @param workspaceId - the id taken from the row's `data-row-key`.
     * @returns true when workspace+ is on for that workspace.
     */
    function isEnabledWorkspace(workspaceId) {
      const workspace = hostState.workspaces.find((candidate) => candidate.id === workspaceId)
      return workspace === undefined ? true : workspace.enabled !== false
    }

    /**
     * Refresh the shared snapshot from the host.
     *
     * @returns whether a usable payload arrived.
     */
    async function refreshHostState() {
      try {
        return publishHostPayload(await fetchWorkspaces())
      } catch {
        return false
      }
    }

    // -----------------------------------------------------------------------
    // The composer's `@` source
    // -----------------------------------------------------------------------

    /**
     * Source name of the `@` group that offers this workspace's labels. It must be
     * unique for its trigger (`ui-reference` owns `@reference`): the input pipeline
     * routes a chip's serializer by source name, and a chip whose source has no
     * registered codec rejects the whole submit.
     */
    const SOURCE_NAME = 'workspace-plus'

    /**
     * Where this group sits in the `@` menu.
     *
     * The pipeline sorts the roster for one trigger by `InputTriggerSource.order`
     * — lower first, `?? 0` when absent, and `Array.prototype.sort` is stable, so
     * every source that omits the field ties at 0 and keeps registration order.
     * That is exactly why this plugin used to land last: it is materialized after
     * the shell's own plugins, and the product's `@` groups are `reference` (0)
     * and `subagent` (0), with `cordis` at 1. Declaring a value below zero is the
     * only way an add-on can precede them, and `-10` leaves the product room for a
     * group or two ahead of 0 without this one having to be re-tuned.
     *
     * The labels are the ones this workspace is actually navigated by, so they
     * belong at the top of the menu rather than under the file tree.
     */
    const SOURCE_ORDER = -10

    /** Section heading of the group's rows, standing in for the pipeline's group title. */
    const SOURCE_SECTION = '工作区目录'

    /** The client session list, captured for the `@` source's cwd lookup. */
    let sessionsService = null

    /**
     * Compare two directory paths the way the host does — separator- and
     * case-insensitively on Windows.
     *
     * @param left - one path.
     * @param right - the other path.
     * @returns whether they name the same directory.
     */
    function samePath(left, right) {
      const fold = (value) =>
        String(value)
          .replace(/[\\/]+$/, '')
          .replace(/\//g, '\\')
          .toLowerCase()
      return fold(left) === fold(right)
    }

    /**
     * The session's working directory, which is the workspace key. `sessions.list`
     * is the same projection `ui-reference` and `ui-session` read; a composition
     * without it simply yields no candidates.
     *
     * @param sessionId - the id from the trigger pipeline's session handle.
     * @returns the cwd, or null.
     */
    function sessionCwd(sessionId) {
      if (sessionsService === null || sessionId === undefined || sessionId === null) return null
      try {
        const cwd = sessionsService.list?.getSnapshot?.()?.byId?.[sessionId]?.cwd
        return typeof cwd === 'string' && cwd !== '' ? cwd : null
      } catch {
        return null
      }
    }

    /**
     * The workspace a session belongs to, or null when it cannot be resolved. Used
     * to order the `@` menu, never to decide whether it has anything to offer.
     *
     * @param session - the pipeline's `{ sessionId }` handle.
     * @returns the host snapshot's workspace entry, or null.
     */
    function workspaceForSession(session) {
      if (!hostState.known) return null
      const cwd = sessionCwd(session?.sessionId)
      if (cwd === null) return null
      return hostState.workspaces.find((candidate) => samePath(candidate.path, cwd)) ?? null
    }

    /**
     * Read back one candidate's opaque payload.
     *
     * @param value - the candidate's `value` string.
     * @returns `{ label, path }`, or undefined when the payload is unusable.
     */
    function parseLabelValue(value) {
      if (typeof value !== 'string') return undefined
      try {
        const parsed = JSON.parse(value)
        if (parsed === null || typeof parsed !== 'object') return undefined
        if (typeof parsed.label !== 'string' || typeof parsed.path !== 'string') return undefined
        return { label: parsed.label, path: parsed.path }
      } catch {
        return undefined
      }
    }

    /**
     * Build the `@` source that offers registered directory labels.
     *
     * A pick inserts a reference chip whose `ref` is the directory's ABSOLUTE PATH,
     * so the submitted prompt carries the path itself rather than a name the model
     * must resolve — the label routing then holds even if the injected table was
     * compacted away. The chip shows the label, and `appearance: 'folder'` draws
     * the shell's folder glyph without marking the chip openable.
     *
     * Candidates come from EVERY enabled workspace, grouped by workspace title,
     * with the calling session's workspace first when its cwd can be read. The
     * session lookup is an ordering refinement, never a requirement: keying the
     * menu on it meant one unresolved cwd turned the whole group into a silent
     * empty list, which is unfalsifiable from the outside.
     *
     * @returns the trigger source.
     */
    function createLabelSource() {
      return {
        trigger: '@',
        name: SOURCE_NAME,
        // Sorting key of the `@` roster; see SOURCE_ORDER for why it is negative.
        order: SOURCE_ORDER,
        // The pipeline's group title would be an untranslated key; each row
        // carries its own section heading instead.
        showGroupTitle: false,
        // MUST be async: the pipeline calls `source.candidates(...).then(...)`, so
        // a synchronous array return throws inside its per-hit fan-out.
        async candidates(session, { query, signal }) {
          if (signal !== undefined && signal.aborted) return []
          const offered = hostState.workspaces.filter(
            (workspace) => workspace.enabled !== false && Array.isArray(workspace.dirs) && workspace.dirs.length > 0,
          )
          if (offered.length === 0) return []
          const cwd = sessionCwd(session?.sessionId)
          const currentIndex =
            cwd === null ? -1 : offered.findIndex((workspace) => samePath(workspace.path, cwd))
          const ordered = currentIndex <= 0 ? offered : [offered[currentIndex], ...offered.filter((_, index) => index !== currentIndex)]
          const needle = String(query ?? '').trim().toLowerCase()
          const matches = (dir) =>
            needle === '' ||
            dir.label.toLowerCase().includes(needle) ||
            (dir.note ?? '').toLowerCase().includes(needle) ||
            dir.path.toLowerCase().includes(needle)
          return ordered.flatMap((workspace) =>
            workspace.dirs.filter(matches).map((dir) => ({
              name: dir.label,
              label: dir.label,
              description: dir.note === undefined ? dir.path : dir.note + ' · ' + dir.path,
              icon: 'folder',
              section: workspace.title === undefined || workspace.title === '' ? workspace.path : workspace.title,
              value: JSON.stringify({ label: dir.label, path: dir.path }),
            })),
          )
        },
        onPick({ candidate }) {
          const value = parseLabelValue(candidate?.value)
          if (value === undefined) return undefined
          return {
            insert: {
              source: SOURCE_NAME,
              ref: value.path,
              label: value.label,
              appearance: 'folder',
              clipboardText: value.path,
            },
          }
        },
        codec: {
          clipboardText: (ref) => ref,
          // The model-facing form IS the absolute path.
          serialize: (ref) => Promise.resolve(ref),
        },
      }
    }

    /**
     * Whether the `@` source is currently registered, and how many labels it would
     * offer. The settings page shows this so "the menu has no group" has a visible
     * cause instead of being unfalsifiable.
     */
    let labelSourceRegistered = false

    /**
     * Summarize the `@` source for the settings page.
     *
     * @returns `{ registered, workspaces, labels }`.
     */
    function labelSourceStatus() {
      const offered = hostState.workspaces.filter(
        (workspace) => workspace.enabled !== false && Array.isArray(workspace.dirs) && workspace.dirs.length > 0,
      )
      return {
        registered: labelSourceRegistered,
        workspaces: offered.length,
        labels: offered.reduce((total, workspace) => total + workspace.dirs.length, 0),
      }
    }

    /**
     * Pick the workspace the dialog shows: the requested id when it still exists,
     * otherwise whatever was selected, otherwise the first one.
     *
     * @param workspaces - the host's workspace list.
     * @param requestedId - the id the trigger asked for.
     * @param currentPath - the path currently selected.
     * @returns the resolved workspace path, or null.
     */
    function selectWorkspace(workspaces, requestedId, currentPath) {
      const requested = requestedId === null || requestedId === undefined
        ? undefined
        : workspaces.find((workspace) => workspace.id === requestedId)
      if (requested !== undefined) return requested.path
      if (currentPath !== null && currentPath !== undefined && workspaces.some((workspace) => workspace.path === currentPath)) {
        return currentPath
      }
      return workspaces[0]?.path ?? null
    }

    /**
     * The shell's directory picker (`ctx.uiWorkspace`), captured while the plugin
     * is mounted. It is injected optionally rather than declared in `inject`, so a
     * composition without ui-workspace keeps the whole plugin working — the dialog
     * simply loses its browse button.
     */
    let directoryPicker = null

    /**
     * The last path segment of a directory path, for either separator.
     *
     * @param path - any directory path.
     * @returns the final segment, or an empty string.
     */
    function basenameOf(path) {
      const parts = String(path).replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts[parts.length - 1] ?? ''
    }

    /**
     * Suggest a label for a picked directory. The host's label grammar is
     * `[A-Za-z0-9][A-Za-z0-9._-]{0,31}`, so anything else is folded to dashes and
     * dropped when nothing valid survives (a CJK directory name yields no guess
     * rather than a label the host would reject).
     *
     * @param path - the picked directory.
     * @returns a valid label, or an empty string when nothing sensible survives.
     */
    function suggestLabel(path) {
      const cleaned = basenameOf(path)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[^A-Za-z0-9]+/, '')
        .slice(0, 32)
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(cleaned) ? cleaned : ''
    }

    /**
     * Fold a picked directory into the draft: the path always follows the picker,
     * and an empty label is filled from the directory's own name.
     *
     * @param draft - the current `{ label, path, note }`.
     * @param pickedPath - the directory the picker returned.
     * @returns the next draft.
     */
    function draftAfterPick(draft, pickedPath) {
      return {
        ...draft,
        path: pickedPath,
        label: draft.label.trim() === '' ? suggestLabel(pickedPath) : draft.label,
      }
    }

    /**
     * Message shown when the shell's picker fails. A cancelled pick resolves to
     * `null` and never reaches here; this path is a real failure (no picker
     * backend, or the browse flow erroring), so it must be visible.
     *
     * @param error - whatever the picker rejected with.
     * @returns the user-facing message.
     */
    function pickErrorMessage(error) {
      return '打开目录选择器失败：' + String((error && error.message) || error)
    }

    /**
     * Whether a registered directory sits outside its workspace root. Such a
     * directory is readable everywhere but only writable when the session's file
     * policy is `danger-full-access`, so the dialog marks it instead of letting
     * the user discover that from a denied write.
     *
     * @param workspacePath - the workspace root directory.
     * @param dirPath - the registered directory.
     * @returns true when the directory is outside the workspace root.
     */
    function isOutside(workspacePath, dirPath) {
      const fold = (value) => String(value).replace(/[\\/]+$/, '').toLowerCase()
      const root = fold(workspacePath)
      const target = fold(dirPath)
      return target !== root && !target.startsWith(root + '\\') && !target.startsWith(root + '/')
    }

    /**
     * Why a directory outside the workspace root is called out at all. It is the
     * tooltip's payload, not row copy: the row carries an icon and the sentence
     * arrives on hover or keyboard focus.
     */
    const OUTSIDE_HINT =
      '该目录在工作区根目录之外。DSH 沙箱只把工作区根目录当作可写根：会话权限不是 danger-full-access 时，' +
      '这里只能读，写入需要逐次批准（agent 会按工具提示发起升级）。'

    /**
     * The warning badge of a directory outside its workspace root: the shell's
     * shield in the theme's warn color, with the explanation on a hover/focus
     * tooltip. It is focusable and labelled, so the warning is not hover-only.
     *
     * @returns the badge element, wrapped in a tooltip when the shell has one.
     */
    function OutsideBadge() {
      const badge = React.createElement(
        'span',
        {
          className: 'dsh-workspace-plus-row-outside',
          role: 'img',
          tabIndex: 0,
          'aria-label': OUTSIDE_HINT,
        },
        React.createElement(
          'svg',
          {
            className: 'dsh-workspace-plus-glyph',
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            fill: 'none',
            xmlns: 'http://www.w3.org/2000/svg',
            'aria-hidden': 'true',
            focusable: 'false',
          },
          React.createElement('path', {
            d: SHIELD_PATH,
            stroke: 'currentColor',
            strokeWidth: 1,
            strokeLinejoin: 'round',
          }),
        ),
      )
      if (Tooltip === null) return badge
      // The bubble is portaled out of the dialog: the modal card clips its own
      // overflow, and its stacking context would cap an in-flow bubble's z-index.
      return React.createElement(
        Tooltip,
        { label: OUTSIDE_HINT, side: 'top', portal: true, maxWidth: 320, delayMs: 120 },
        badge,
      )
    }

    /**
     * One registered directory row: glyph, label, absolute path, optional note,
     * the outside-the-root badge, and the remove control.
     *
     * The remove control is the shell's own cross rather than a labelled button:
     * every row carries one, and a word repeated down the list is what made the
     * earlier table read as a form instead of a list. Its accessible name still
     * says exactly what it removes.
     *
     * @param props - the row's directory, its workspace root, and the remove handler.
     * @returns the row element.
     */
    function DirectoryRow({ dir, workspacePath, onRemove, disabled }) {
      const outside = isOutside(workspacePath, dir.path)
      return React.createElement(
        'div',
        { className: 'dsh-workspace-plus-row' },
        React.createElement(
          'span',
          { className: 'dsh-workspace-plus-field-glyph' },
          React.createElement(FolderGlyph, { size: 16 }),
        ),
        React.createElement('span', { className: 'dsh-workspace-plus-row-tag', title: dir.label }, dir.label),
        React.createElement('span', { className: 'dsh-workspace-plus-row-path', title: dir.path }, dir.path),
        dir.note === undefined
          ? null
          : React.createElement('span', { className: 'dsh-workspace-plus-row-note', title: dir.note }, dir.note),
        outside ? React.createElement(OutsideBadge) : null,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-workspace-plus-remove',
            disabled,
            'aria-label': '移除 ' + dir.label,
            title: '移除 ' + dir.label,
            onClick: () => onRemove(dir.label),
          },
          React.createElement(CloseGlyph, { size: 16 }),
        ),
      )
    }

    /**
     * The dialog entry registered into `shell.overlay`.
     *
     * `props.initial` and `props.dialog` exist only as a test seam — the shell
     * renders overlay entries with its own standard props and no owner props.
     *
     * @param props - optional initial state for tests.
     * @returns the dialog element (or null while closed).
     */
    function WorkdirsDialog(props) {
      const dialog = React.useSyncExternalStore(subscribeDialog, readDialog)
      const [state, setState] = React.useState(props?.initial ?? WORKDIRS_IDLE)
      const [draft, setDraft] = React.useState({ label: '', path: '', note: '' })
      const [picking, setPicking] = React.useState(false)

      const patch = (changes) => setState((current) => ({ ...current, ...changes }))

      /** Fold one successful host payload into the dialog state. */
      const applyPayload = (payload, requestedId) => {
        publishHostPayload(payload)
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
          setState((current) => ({
            ...current,
            status: 'error',
            busy: false,
            ok: false,
            message: (payload && payload.message) || 'host returned an unusable payload',
          }))
          return
        }
        const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : []
        // The trigger names the workspace, so the dialog edits THAT one and shows
        // no picker. Only a trigger without a workspace (the sidebar fallback)
        // leaves the choice open.
        const locked = requestedId === null || requestedId === undefined
          ? null
          : workspaces.find((workspace) => workspace.id === requestedId) ?? null
        setState((current) => ({
          ...current,
          status: 'ready',
          busy: false,
          ok: null,
          message: '',
          workspaces,
          registryAvailable: payload.registryAvailable !== false,
          locked: locked !== null,
          selected: locked !== null ? locked.path : selectWorkspace(workspaces, requestedId, current.selected),
        }))
      }

      const load = async (requestedId) => {
        patch({ busy: true })
        try {
          applyPayload(await fetchWorkspaces(), requestedId)
        } catch (error) {
          patch({ status: 'error', busy: false, ok: false, message: String((error && error.message) || error) })
        }
      }

      const submit = async (payload) => {
        patch({ busy: true })
        try {
          const result = await postOperation(payload)
          if (result === null || typeof result !== 'object') {
            patch({ busy: false, ok: false, message: 'host returned an unusable payload' })
            return false
          }
          publishHostPayload(result)
          const workspaces = Array.isArray(result.workspaces) ? result.workspaces : state.workspaces
          setState((current) => ({
            ...current,
            status: 'ready',
            busy: false,
            ok: result.ok === true,
            message: String(result.message ?? ''),
            workspaces,
            registryAvailable: result.registryAvailable !== false,
            selected: selectWorkspace(workspaces, null, current.selected),
          }))
          return result.ok === true
        } catch (error) {
          patch({ status: 'error', busy: false, ok: false, message: String((error && error.message) || error) })
          return false
        }
      }

      // Refetch whenever the dialog opens, and whenever a trigger names a
      // different workspace, so the table is never stale.
      const open = dialog.open
      const requestedId = dialog.workspaceId
      React.useEffect(() => {
        if (!open) return undefined
        let cancelled = false
        const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
        ;(async () => {
          try {
            const payload = await fetchWorkspaces(controller?.signal)
            if (cancelled) return
            applyPayload(payload, requestedId)
          } catch (error) {
            if (cancelled) return
            setState((current) => ({
              ...current,
              status: 'error',
              busy: false,
              ok: false,
              message: String((error && error.message) || error),
            }))
          }
        })()
        return () => {
          cancelled = true
          controller?.abort()
        }
      }, [open, requestedId])

      const selected = state.workspaces.find((workspace) => workspace.path === state.selected) ?? null
      const dirs = selected === null ? [] : selected.dirs
      /** Without `ctx.uiWorkspace` there is no picker, and the path has no manual entry. */
      const pickerAvailable = directoryPicker !== null && directoryPicker !== undefined

      const addDirectory = async () => {
        if (selected === null) return
        const added = await submit({
          op: 'add',
          workspace: selected.path,
          label: draft.label,
          path: draft.path,
          note: draft.note,
        })
        if (added) setDraft({ label: '', path: '', note: '' })
      }

      const removeDirectory = async (label) => {
        if (selected === null) return
        await submit({ op: 'remove', workspace: selected.path, label })
      }

      /**
       * Ask the shell's directory picker for a directory. A cancelled picker
       * resolves to `null` and changes nothing; a failed one reports the reason
       * where the add result goes, so the dialog never fails silently.
       */
      const browse = async () => {
        if (directoryPicker === null || directoryPicker === undefined) return
        setPicking(true)
        try {
          const picked = await directoryPicker.pickDirectory()
          if (typeof picked === 'string' && picked !== '') setDraft((current) => draftAfterPick(current, picked))
        } catch (error) {
          patch({ ok: false, message: pickErrorMessage(error) })
        } finally {
          setPicking(false)
        }
      }

      /**
       * The dialog's blocks, in reading order. Every one of them is a bordered
       * surface with the row grid inside, so the dialog reads as one column of
       * like things rather than a toolbar, a table and a form stacked on top of
       * each other.
       */
      const identity =
        selected === null
          ? null
          : React.createElement(
              'div',
              { className: 'dsh-workspace-plus-field' },
              React.createElement(
                'span',
                { className: 'dsh-workspace-plus-field-glyph' },
                React.createElement(FolderGlyph, { size: 16 }),
              ),
              state.locked
                ? React.createElement(
                    'span',
                    { className: 'dsh-workspace-plus-field-title', title: selected.title || selected.path },
                    selected.title || selected.path,
                  )
                : React.createElement(
                    'select',
                    {
                      className: 'dsh-workspace-plus-select',
                      value: state.selected ?? '',
                      disabled: state.workspaces.length === 0,
                      'aria-label': '选择工作区',
                      onChange: (event) => patch({ selected: event.target.value === '' ? null : event.target.value }),
                    },
                    state.workspaces.length === 0
                      ? React.createElement('option', { value: '' }, '（没有可用工作区）')
                      : state.workspaces.map((workspace) =>
                          React.createElement(
                            'option',
                            { key: workspace.id, value: workspace.path },
                            (workspace.title || workspace.path) + ' — ' + workspace.path,
                          ),
                        ),
                  ),
              // The trigger names the workspace, so the locked row also says which
              // root its labels resolve against.
              state.locked
                ? React.createElement(
                    'span',
                    { className: 'dsh-workspace-plus-field-root', title: selected.path },
                    selected.path,
                  )
                : null,
            )

      const sectionLabel = React.createElement('div', { className: 'dsh-workspace-plus-section' }, '目录')

      const listBlock = (...children) =>
        React.createElement('div', { className: 'dsh-workspace-plus-list' }, ...children)

      const emptyRow = (text) =>
        React.createElement('div', { className: 'dsh-workspace-plus-field-row dsh-workspace-plus-empty' }, text)

      const noticeBlock = (variant, ...children) =>
        React.createElement(
          'div',
          {
            className:
              'dsh-workspace-plus-notice' +
              (variant === '' || variant === undefined ? '' : ' dsh-workspace-plus-notice-' + variant),
          },
          ...children,
        )

      /**
       * The add group. Its row IS the picker — there is no path to type into — and
       * the label/note row appears only once a directory has been chosen, so an
       * idle dialog is a list plus one row, not a form with two empty fields.
       */
      const addGroup = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-list' },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-workspace-plus-field-row dsh-workspace-plus-add',
            disabled: selected === null || state.busy || picking || !pickerAvailable,
            'aria-label': '选择目录',
            title: pickerAvailable
              ? '打开目录选择器'
              : '当前页面没有挂载 ui-workspace，目录选择器不可用；可在对话里用 workspace_dirs 登记',
            onClick: () => void browse(),
          },
          React.createElement(
            'span',
            { className: 'dsh-workspace-plus-field-glyph' },
            React.createElement(PlusGlyph, { size: 16 }),
          ),
          React.createElement(
            'span',
            {
              className:
                draft.path === ''
                  ? 'dsh-workspace-plus-add-text'
                  : 'dsh-workspace-plus-add-text dsh-workspace-plus-add-path',
              ...(draft.path === '' ? {} : { title: draft.path }),
            },
            picking ? '选择中…' : draft.path === '' ? '添加目录' : draft.path,
          ),
        ),
        draft.path === ''
          ? null
          : React.createElement(
              'div',
              { className: 'dsh-workspace-plus-field-row dsh-workspace-plus-draft' },
              React.createElement('input', {
                className: 'dsh-workspace-plus-input dsh-workspace-plus-input-label',
                placeholder: '标签，如 backend',
                'aria-label': '标签',
                value: draft.label,
                disabled: state.busy,
                onChange: (event) => setDraft({ ...draft, label: event.target.value }),
              }),
              React.createElement('input', {
                className: 'dsh-workspace-plus-input dsh-workspace-plus-input-note',
                placeholder: '说明（可选）',
                'aria-label': '说明',
                value: draft.note,
                disabled: state.busy,
                onChange: (event) => setDraft({ ...draft, note: event.target.value }),
              }),
              React.createElement(
                Button,
                {
                  variant: 'primary',
                  className: 'dsh-workspace-plus-submit',
                  disabled: state.busy || draft.path === '',
                  onClick: () => void addDirectory(),
                },
                '添加',
              ),
            ),
      )

      // The switch that turned this workspace off is on the settings page, not
      // here, so the state is stated where the user is already looking.
      const disabledNotice =
        selected === null || selected.enabled !== false
          ? null
          : noticeBlock(
              'warn',
              React.createElement(
                'div',
                { className: 'dsh-workspace-plus-off' },
                '这个工作区已在 workspace+ 里停用：标签不会注入对话，workspace_dirs 工具也会拒绝操作。' +
                  '到 设置 → workspace+ 打开它的开关即可恢复。',
              ),
            )

      // The host's own sentence about what it just did — the only status copy the
      // dialog shows, and only while it is true. A failed read is not repeated
      // here: its notice above already says it, at length.
      const statusLine =
        state.status === 'error' || state.message === ''
          ? null
          : React.createElement(
              'div',
              {
                className:
                  'dsh-workspace-plus-status ' +
                  (state.ok === false ? 'dsh-workspace-plus-error' : 'dsh-workspace-plus-ok'),
              },
              state.message,
            )

      const bodyBlocks = (() => {
        if (state.status === 'error') {
          const unauthorized = state.message.includes('401')
          const unrouted = state.message.includes('404')
          /**
           * The three failures need different advice:
           * - 401: this document never completed the token exchange, so the
           *   connection layer has no authority to admit the request.
           * - 404: the request reached the Host and nothing claimed the path.
           *   The browser half hot-reloads from the served bundle, the host half
           *   does not, so a stale Host process is the ordinary cause.
           * - anything else: the transport itself (a page with no HTTP carrier).
           */
          const diagnosis = unauthorized
            ? '这个页面没有带授权的会话凭据。请用 `dsh` 启动时打印的带 token 的地址重新打开 GUI（它会写入 cookie，然后跳转到干净地址）。'
            : unrouted
              ? '请求到达了 DSH 宿主进程，但宿主里没有注册 ' +
                API_PATH +
                ' 这条路由——通常意味着宿主进程还在跑旧版插件代码。浏览器半会随 bundle 热更新，宿主半不会：重启 dsh 即可。' +
                '重启后终端会出现 [dsh-workspace-plus] host half loaded 一行；若没有，请到 设置 → 插件 查看该插件行的状态。'
              : '这个面板通过 ' +
                API_PATH +
                ' 与宿主进程通信，而当前页面没有可用的 HTTP 通道（例如页面不是 dsh 提供的、或宿主进程还没起来）。'
          return [
            noticeBlock(
              'error',
              React.createElement('div', { className: 'dsh-workspace-plus-error' }, '无法连接 host 接口：' + state.message),
              React.createElement('div', { className: 'dsh-workspace-plus-note' }, diagnosis),
              React.createElement(
                'div',
                { className: 'dsh-workspace-plus-note' },
                '宿主半加载之后，映射也可以在对话里用 workspace_dirs 工具管理。',
              ),
            ),
          ]
        }
        if (!state.registryAvailable) {
          return [
            noticeBlock(
              '',
              React.createElement(
                'div',
                { className: 'dsh-workspace-plus-note' },
                '宿主进程没有加载 workspace 注册表，无法列出工作区。请在对话里用 workspace_dirs 工具按绝对路径管理标签。',
              ),
            ),
          ]
        }
        if (state.status === 'loading') {
          return [sectionLabel, listBlock(emptyRow('正在读取…'))]
        }
        if (selected === null) {
          return [
            noticeBlock(
              '',
              React.createElement(
                'div',
                { className: 'dsh-workspace-plus-note' },
                '还没有任何工作区。先在左侧边栏新建一个工作区，再回到这里登记目录。',
              ),
            ),
          ]
        }
        const rows = dirs.map((dir) =>
          React.createElement(DirectoryRow, {
            key: dir.label,
            dir,
            workspacePath: selected.path,
            disabled: state.busy,
            onRemove: (label) => void removeDirectory(label),
          }),
        )
        return [
          sectionLabel,
          listBlock(...(rows.length === 0 ? [emptyRow('还没有登记目录')] : rows)),
          addGroup,
        ]
      })()

      const blocks = [identity, ...bodyBlocks, disabledNotice, statusLine].filter(
        (block) => block !== null && block !== undefined,
      )

      return React.createElement(
        Modal,
        {
          open,
          onClose: closeWorkdirsDialog,
          title: '工作区目录设置',
          closeLabel: '关闭',
          // The card is wider than the shell's 380px default: a row carries a
          // label, an absolute path, a note and a badge.
          className: 'dsh-workspace-plus-dialog-card',
          // Secondary action left, primary right — the same split the shell's own
          // product dialogs use, so the footer reads without a second look.
          footer: React.createElement(
            'div',
            { className: 'dsh-workspace-plus-footer' },
            React.createElement(
              Button,
              { variant: 'ghost', disabled: state.busy, onClick: () => void load(requestedId) },
              '刷新',
            ),
            React.createElement(Button, { variant: 'primary', onClick: closeWorkdirsDialog }, '完成'),
          ),
        },
        React.createElement('div', { className: 'dsh-workspace-plus-dialog' }, ...blocks),
      )
    }

    /**
     * The `workspace+` settings page, registered into `settings.section`.
     *
     * It owns one preference per workspace: whether the feature runs there. That
     * single switch covers the two surfaces the feature itself drives — the label
     * table injected into that workspace's conversations and the `workspace_dirs`
     * tool. It deliberately does NOT cover the workspace row button: every row
     * keeps its management entry point, so a switched-off workspace can still be
     * inspected (and understood) instead of silently losing its only way in.
     *
     * Every workspace defaults to on except the default (first-use) one, which
     * belongs to the product rather than to this plugin and therefore starts off.
     * A switch writes an explicit override for that workspace; nothing is deleted
     * when it is turned off, so a workspace can be switched back on at any time
     * without losing the labels registered in it.
     *
     * @param props - optional initial state for tests.
     * @returns the settings section element.
     */
    function WorkspacePlusSettings(props) {
      const host = React.useSyncExternalStore(subscribeHostState, readHostState)
      const [state, setState] = React.useState(props?.initial ?? { status: 'loading', message: '', ok: null, busy: false })

      const patch = (changes) => setState((current) => ({ ...current, ...changes }))

      React.useEffect(() => {
        let cancelled = false
        const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
        ;(async () => {
          try {
            const payload = await fetchWorkspaces(controller?.signal)
            if (cancelled) return
            if (!publishHostPayload(payload)) {
              setState((current) => ({
                ...current,
                status: 'error',
                message: (payload && payload.message) || 'host returned an unusable payload',
              }))
              return
            }
            setState((current) => ({ ...current, status: 'ready', message: '' }))
          } catch (error) {
            if (cancelled) return
            setState((current) => ({
              ...current,
              status: 'error',
              message: String((error && error.message) || error),
            }))
          }
        })()
        return () => {
          cancelled = true
          controller?.abort()
        }
      }, [])

      /**
       * Flip one workspace's switch. The key is the one the host published for
       * that workspace, so the two halves cannot disagree about path spelling.
       *
       * @param key - the workspace's settings key.
       * @param next - the requested state.
       */
      const toggle = async (key, next) => {
        patch({ busy: true })
        try {
          const result = await postOperation({
            op: 'settings',
            settings: { [WORKSPACE_ENABLED_SETTING]: { [key]: next } },
          })
          if (result === null || typeof result !== 'object') {
            patch({ busy: false, ok: false, message: 'host returned an unusable payload' })
            return
          }
          publishHostPayload(result)
          patch({ busy: false, ok: result.ok === true, message: String(result.message ?? '') })
        } catch (error) {
          patch({ busy: false, ok: false, message: String((error && error.message) || error) })
        }
      }

      const unavailable = state.status === 'error'

      /**
       * A workspace can only be switched from the key the host published for it.
       * Guessing one from the path is not an option: the host folds case on
       * Windows, so a guessed key would be accepted, stored, and then never match
       * — a silent no-op. A payload without keys means a stale host half, which
       * the page reports instead.
       */
      const keyOf = (workspace) => (typeof workspace.key === 'string' && workspace.key !== '' ? workspace.key : null)
      const staleHost = host.known && host.workspaces.some((workspace) => keyOf(workspace) === null)

      const workspaceRows = host.workspaces.map((workspace) => {
        const key = keyOf(workspace)
        return React.createElement(
          'div',
          { key: workspace.id, className: 'dsh-workspace-plus-settings-row' },
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-text' },
            React.createElement(
              'div',
              { className: 'dsh-workspace-plus-settings-title' },
              workspace.title || workspace.path,
              workspace.isDefault === true
                ? React.createElement('span', { className: 'dsh-workspace-plus-settings-tag' }, '默认工作区')
                : null,
            ),
            React.createElement(
              'div',
              { className: 'dsh-workspace-plus-settings-description' },
              React.createElement('span', { className: 'dsh-workspace-plus-mono' }, workspace.path),
              workspace.isDefault === true
                ? '（默认关闭，打开后它的对话才会看到标签表）'
                : null,
            ),
          ),
          React.createElement(Switch, {
            checked: workspace.enabled !== false,
            disabled: state.busy || unavailable || key === null,
            label: (workspace.title || workspace.path) + ' 启用 workspace+',
            onChange: (next) => void toggle(key, next),
          }),
        )
      })

      const workspaceList = (() => {
        if (state.status === 'loading' && host.workspaces.length === 0) {
          return React.createElement('div', { className: 'dsh-workspace-plus-settings-description' }, '正在读取工作区…')
        }
        if (host.workspaces.length === 0) {
          return React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-description' },
            '没有可用的工作区。在左侧边栏新建一个工作区后，这里会出现它自己的开关。',
          )
        }
        return workspaceRows
      })()

      const status = (() => {
        if (staleHost) {
          return React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-error' },
            '宿主返回的工作区数据里没有 key，无法按工作区切换 —— 通常是宿主进程还在跑旧版插件代码。重启 dsh 即可。',
          )
        }
        // A failed READ needs the transport diagnosis; a rejected WRITE only needs
        // the host's own message.
        if (state.status === 'error') {
          const unrouted = state.message.includes('404')
          return React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-error' },
            '无法读取宿主设置：' + state.message,
            unrouted
              ? '（宿主里没有 ' + API_PATH + ' 这条路由，通常意味着 dsh 还没重启）'
              : '',
          )
        }
        if (state.message === '') return null
        return React.createElement(
          'div',
          { className: state.ok === false ? 'dsh-workspace-plus-settings-error' : 'dsh-workspace-plus-settings-ok' },
          state.message,
        )
      })()

      const sourceStatus = labelSourceStatus()
      const atLine = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-settings-description' },
        '输入框 `@` 候选：',
        sourceStatus.registered
          ? sourceStatus.labels === 0
            ? '候选源已注册，但还没有可用的标签 —— 先在工作区行里登记目录。'
            : '候选源已注册，共 ' +
              String(sourceStatus.labels) +
              ' 个标签（分布在 ' +
              String(sourceStatus.workspaces) +
              ' 个工作区）。'
          : '候选源未注册 —— 当前页面可能还是旧的插件 bundle，重启 dsh 并强制刷新页面。',
      )

      return React.createElement(
        'div',
        { className: 'dsh-workspace-plus-settings' },
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-settings-description' },
          '按工作区启用：开关控制注入这个工作区对话上下文的标签表，以及 ',
          React.createElement('span', { className: 'dsh-workspace-plus-mono' }, 'workspace_dirs'),
          ' 工具。关掉不会删除已登记的标签，也不会收走工作区行上的目录按钮——那个按钮在任何工作区都能打开弹窗。',
        ),
        workspaceList,
        atLine,
        status,
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-settings-description' },
          '标签本身在每个工作区的「工作区目录设置」弹窗里维护：悬停左侧工作区那一行的目录按钮即可打开。',
        ),
      )
    }

    /**
     * The `main` panel that holds the fallback entry's key. The shell's sidebar
     * button always calls `layout.selectPanel(id)` — which throws for an
     * unregistered key — so this key must exist even though the intended path is
     * the dialog.
     *
     * @returns the hint panel element.
     */
    function WorkdirsHintPanel() {
      return React.createElement(
        'div',
        { className: 'dsh-workspace-plus-panel' },
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-card' },
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-badge' },
            React.createElement(WorkdirsPanelIcon, { size: 28 }),
          ),
          React.createElement('h1', { className: 'dsh-workspace-plus-title' }, '工作区目录设置'),
          React.createElement(
            'p',
            { className: 'dsh-workspace-plus-subtitle' },
            '这个功能以弹窗形式提供：点击侧边栏工作区那一行的目录按钮即可打开。',
          ),
          React.createElement(Button, { variant: 'primary', onClick: () => openWorkdirsDialog(null) }, '现在打开'),
        ),
      )
    }

    /**
     * Put the directory button in its seat inside a row's action cluster, and
     * keep it there across React re-renders.
     *
     * The shell renders that cluster as `[「更多」menu, 「新会话」button]` and this
     * plugin's button belongs between them, so the row reads
     * 「更多 · 工作区目录设置 · 新会话」and the new-session button stays the last
     * one. Inserting BEFORE the cluster's last element child is what achieves
     * that; `insertBefore(node, null)` appends, so a cluster with a single child
     * degrades to "after the menu" instead of splitting a pair that is not there.
     *
     * React re-renders the row without knowing this node exists, and it may
     * re-insert its own children around ours — so the position is re-asserted on
     * every reconcile pass rather than set once at creation.
     *
     * Re-assert only when the seat actually moved: `insertBefore` on a node that
     * is already exactly where it belongs still detaches and re-attaches it, and
     * a real pointer press that spans such a re-seat never becomes a click — the
     * browser drops the click because the press target was not connected when the
     * pointer was released. Reconcile runs on every DOM mutation in the frame, so
     * that detach used to land inside almost every press and the button was
     * unclickable while still looking (and hit-testing) perfectly fine.
     *
     * @param actions - the row's action cluster.
     * @param button - this plugin's button.
     */
    function seatRowButton(actions, button) {
      const last = actions.lastElementChild
      if (last === button) return
      const anchor = actions.children.length > 1 ? last : null
      if (button.parentElement === actions && button.nextElementSibling === anchor) return
      actions.insertBefore(button, anchor)
    }

    /**
     * Paint one row button with the switch state of its workspace.
     *
     * The button exists for every workspace, so this is also the only place the
     * switched-off state is visible on the row: the marker class dims the glyph
     * and the label says why, while the click still opens the dialog — which is
     * where those labels live and where the user decides what to do next.
     *
     * Idempotent, so the reconcile pass can call it on every button it already
     * owns without touching the DOM when nothing changed.
     *
     * @param button - this plugin's button on that row.
     * @param workspaceId - the id taken from the row's `data-row-key`.
     */
    function markRowButton(button, workspaceId) {
      const enabled = isEnabledWorkspace(workspaceId)
      const label = enabled ? ROW_BUTTON_LABEL : ROW_BUTTON_LABEL_OFF
      button.classList.toggle(ROW_BUTTON_OFF_CLASS, !enabled)
      if (button.title !== label) button.title = label
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
    }

    /**
     * Insert the directory button into every workspace row and keep it there.
     *
     * The shell's workspace row menu is hardcoded to Rename/Delete and exposes no
     * slot, so the trigger is injected into the row's action cluster instead. The
     * anchors are shell-emitted data attributes rather than hashed class names:
     * `data-slot="sidebar.workspaces"` on the browser outlet and
     * `data-row-key="workspace:<workspaceId>"` on a group row (that id is
     * `Workspace.id` from the host registry).
     *
     * A MutationObserver reconciles additions, removals, and position, because
     * React re-renders the row without knowing this node exists.
     *
     * Every real workspace row carries the button, including one whose `enabled`
     * flag is false (the default Workspace before the user turns its switch on,
     * or a workspace the user switched off). The switch governs whether the
     * label table runs for that workspace — context injection and the
     * `workspace_dirs` tool — never whether its management UI can be reached:
     * the dialog is the only place those labels can be read, and the settings
     * page is the only place the switch can be flipped, so hiding the trigger
     * would strand both. A switched-off workspace only changes the button's
     * tooltip and draws it dimmed, and `refresh()` re-reads the state after a
     * settings change.
     *
     * @param options - the availability callback, fired when the injected count changes.
     * @returns `{ dispose, available, refresh }`.
     */
    function installWorkspaceRowButtons({ onAvailability } = {}) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
        return { dispose: () => {}, available: () => false, refresh: () => {} }
      }
      const injected = new Map()
      let scheduled = false
      let stopped = false
      let lastReported = null

      const report = () => {
        const available = injected.size > 0
        if (available === lastReported) return
        lastReported = available
        if (typeof onAvailability === 'function') onAvailability(available)
      }

      const reconcile = () => {
        scheduled = false
        if (stopped) return
        const container = document.querySelector(SIDEBAR_SLOT_SELECTOR)
        // Nothing is mounted yet: reporting here would flash the fallback entry.
        if (container === null) return
        const rows = container.querySelectorAll(WORKSPACE_ROW_SELECTOR)
        const live = new Set(rows)
        for (const [row, button] of [...injected]) {
          const workspaceId = (row.getAttribute('data-row-key') ?? '').slice(ROW_KEY_PREFIX.length)
          const stillWanted = live.has(row) && row.isConnected && workspaceId !== ''
          if (stillWanted) continue
          button.remove()
          injected.delete(row)
        }
        for (const row of rows) {
          const workspaceId = (row.getAttribute('data-row-key') ?? '').slice(ROW_KEY_PREFIX.length)
          // The synthetic "ungrouped" row carries the empty key and owns no workspace.
          if (workspaceId === '') continue
          const actions = row.lastElementChild
          if (actions === null || actions === undefined) continue
          const existing = injected.get(row)
          if (existing !== undefined && existing.isConnected) {
            // Already there: only its seat and its switch state may have moved.
            seatRowButton(actions, existing)
            markRowButton(existing, workspaceId)
            continue
          }
          const button = document.createElement('button')
          button.type = 'button'
          button.className = ROW_BUTTON_CLASS
          button.title = ROW_BUTTON_LABEL
          button.setAttribute('aria-label', ROW_BUTTON_LABEL)
          button.innerHTML = ROW_BUTTON_GLYPH
          /**
           * Open the dialog for the row the button currently sits on. The key is
           * read here rather than captured, because the button outlives a row
           * whose key changes.
           */
          const activate = (event) => {
            // Keep the activation off the row, whose own handler toggles the group.
            event.preventDefault()
            event.stopPropagation()
            const current = (row.getAttribute('data-row-key') ?? '').slice(ROW_KEY_PREFIX.length)
            openWorkdirsDialog(current === '' ? null : current)
          }
          button.addEventListener('click', activate)
          /**
           * A press can still lose its click when the shell's React replaces part
           * of the row mid-press (the browser then drops the click, because the
           * press target is no longer connected at release). The release itself
           * always arrives, so it opens the same dialog; a following click is a
           * no-op because the store ignores a repeated identical open.
           *
           * Touch is excluded: a scroll-drag that happens to start on this 16px
           * button delivers its release here through implicit pointer capture,
           * and opening the dialog then would be wrong. Taps still open it
           * through the click that follows.
           */
          button.addEventListener('pointerup', (event) => {
            if (event.button === 0 && event.pointerType !== 'touch') activate(event)
          })
          markRowButton(button, workspaceId)
          seatRowButton(actions, button)
          injected.set(row, button)
        }
        report()
      }

      const schedule = () => {
        if (scheduled || stopped) return
        scheduled = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reconcile)
        else setTimeout(reconcile, 16)
      }

      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      reconcile()

      return {
        available: () => injected.size > 0,
        refresh: () => {
          if (stopped) return
          reconcile()
        },
        dispose: () => {
          stopped = true
          observer.disconnect()
          for (const button of injected.values()) button.remove()
          injected.clear()
        },
      }
    }

    // -----------------------------------------------------------------------
    // Plugin
    // -----------------------------------------------------------------------

    /**
     * Services this browser plugin needs. `slots` is required to contribute
     * anything at all; the sidebar buttons and the panel selection are owned by
     * the shell, so this half never touches `ctx.layout` itself.
     */
    const inject = ['slots']

    /**
     * Contribute the `workspace+` settings page, the directory dialog, its
     * fallback entry, and the workspace-row buttons that open it — plus the two
     * client faces of the 通知 sub-feature (its settings page and the
     * pending-open poll behind notification clicks).
     *
     * Every registration goes through `ctx.slots.inject(key, callback)`: the
     * callback runs as soon as the shell declares that slot (immediately when it
     * already exists), and its returned disposer is owned by this plugin's fiber,
     * so unloading the plugin removes the entry again.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      // The settings page owns the default-Workspace switch.
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: SETTINGS_SECTION_ID,
                order: SETTINGS_SECTION_ORDER,
                label: SETTINGS_SECTION_LABEL,
              },
              WorkspacePlusSettings,
            ),
          ),
        'dsh-workspace-plus: settings section',
      )

      // The 通知 sub-feature. Both faces are guarded by `registerNotice`: a
      // failure is reported and skipped instead of failing the fiber, because
      // the shell's boot audit treats every non-ACTIVE entry as fatal and the
      // workspace+ features must survive a notice-side mistake. The poll runs
      // unconditionally — clicking an older notification must still open the
      // conversation even while the notice ROW is off (its host half answers
      // 404, the poll backs off quietly). The settings page lives in the same
      // slot with the id/order dsh-notice used, so it reads as the same page.
      registerNotice(ctx, '通知轮询', () => ctx.effect(() => startNoticePendingPoll(ctx), 'dsh-workspace-plus/notice: pending open poll'))
      registerNotice(ctx, '通知设置页', () =>
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: NOTICE_SETTINGS_SECTION_ID,
                  order: NOTICE_SETTINGS_SECTION_ORDER,
                  label: NOTICE_SETTINGS_SECTION_LABEL,
                },
                NoticeSettings,
              ),
            ),
          'dsh-workspace-plus/notice: settings section',
        ),
      )

      // The dialog lives in the frame-wide overlay: the same seat the shell's own
      // workspace Rename/Delete dialogs occupy.
      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'workdirs-dialog', order: 50 }, WorkdirsDialog),
          ),
        'dsh-workspace-plus: workdirs dialog',
      )

      // The fallback entry's main key always exists; the entry itself is
      // registered only while no workspace-row button could be installed.
      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: WORKDIRS_PANEL_ID }, WorkdirsHintPanel),
          ),
        'dsh-workspace-plus: workdirs fallback panel',
      )

      // The dialog's browse button asks the shell's own picker. Injected
      // optionally: a composition without ui-workspace still loads this plugin,
      // the button just stays disabled.
      ctx.effect(
        () =>
          ctx.inject(['uiWorkspace'], (uiScope) => {
            directoryPicker = uiScope.uiWorkspace
            return () => {
              directoryPicker = null
            }
          }),
        'dsh-workspace-plus: directory picker',
      )

      // The `@` source and the session list it keys off. Both are injected
      // optionally: without them the composer simply offers no label group.
      ctx.inject(['sessions'], (sessionScope) => {
        sessionScope.effect(
          () => {
            sessionsService = sessionScope.sessions
            return () => {
              sessionsService = null
            }
          },
          'dsh-workspace-plus: session list',
        )
      })

      ctx.inject(['inputTriggers'], (triggerScope) => {
        triggerScope.effect(
          () => {
            const dispose = triggerScope.inputTriggers.registerSource(createLabelSource())
            labelSourceRegistered = true
            return () => {
              labelSourceRegistered = false
              dispose()
            }
          },
          'dsh-workspace-plus: @ label source',
        )
      })

      let registerEntry = null
      let entryDispose = null
      let rowEntryAvailable = false
      let settled = false

      const syncEntry = () => {
        if (registerEntry === null) return
        const wantFallback = !rowEntryAvailable && settled
        if (wantFallback && entryDispose === null) entryDispose = registerEntry()
        if (!wantFallback && entryDispose !== null) {
          entryDispose()
          entryDispose = null
        }
      }

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.panellist', () => {
            registerEntry = () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: WORKDIRS_PANEL_ID,
                  order: WORKDIRS_PANEL_ORDER,
                  label: WORKDIRS_PANEL_LABEL,
                },
                WorkdirsEntryIcon,
              )
            syncEntry()
            return () => {
              registerEntry = null
              if (entryDispose !== null) {
                entryDispose()
                entryDispose = null
              }
            }
          }),
        'dsh-workspace-plus: workdirs fallback entry',
      )

      const settleTimer = setTimeout(() => {
        settled = true
        syncEntry()
      }, FALLBACK_SETTLE_MS)

      const rowButtons = installWorkspaceRowButtons({
        onAvailability: (available) => {
          rowEntryAvailable = available
          settled = true
          syncEntry()
        },
      })

      // Warm the shared snapshot at boot and keep every row button in step with
      // the settings: a switch flipped in the settings page re-marks its button
      // (dimmed, with the reason in its tooltip) without a reload.
      const offHostState = subscribeHostState(() => rowButtons.refresh())
      void refreshHostState()

      ctx.effect(
        () => () => {
          clearTimeout(settleTimer)
          offHostState()
          rowButtons.dispose()
        },
        'dsh-workspace-plus: workspace row buttons',
      )
    }

    exports.WORKDIRS_PANEL_ID = WORKDIRS_PANEL_ID
    exports.WORKDIRS_PANEL_LABEL = WORKDIRS_PANEL_LABEL
    exports.SETTINGS_SECTION_ID = SETTINGS_SECTION_ID
    exports.SETTINGS_SECTION_LABEL = SETTINGS_SECTION_LABEL
    exports.SETTINGS_SECTION_ORDER = SETTINGS_SECTION_ORDER
    exports.NOTICE_SETTINGS_SECTION_ID = NOTICE_SETTINGS_SECTION_ID
    exports.NOTICE_SETTINGS_SECTION_LABEL = NOTICE_SETTINGS_SECTION_LABEL
    exports.NOTICE_SETTINGS_SECTION_ORDER = NOTICE_SETTINGS_SECTION_ORDER
    exports.NOTICE_API_PATH = NOTICE_API_PATH
    exports.NOTICE_PENDING_PATH = NOTICE_PENDING_PATH
    exports.NOTICE_POLL_INTERVAL_MS = NOTICE_POLL_INTERVAL_MS
    exports.NOTICE_POLL_RETRY_MS = NOTICE_POLL_RETRY_MS
    exports.fetchNoticeSnapshot = fetchNoticeSnapshot
    exports.postNoticeOperation = postNoticeOperation
    exports.NoticeSwitchRow = NoticeSwitchRow
    exports.NoticeSettings = NoticeSettings
    exports.startNoticePendingPoll = startNoticePendingPoll
    exports.registerNotice = registerNotice
    exports.ensureNoticeStyles = ensureNoticeStyles
    exports.DEFAULT_WORKSPACE_SETTING = DEFAULT_WORKSPACE_SETTING
    exports.WORKSPACE_ENABLED_SETTING = WORKSPACE_ENABLED_SETTING
    exports.API_PATH = API_PATH
    exports.ROW_BUTTON_CLASS = ROW_BUTTON_CLASS
    exports.ROW_BUTTON_OFF_CLASS = ROW_BUTTON_OFF_CLASS
    exports.ROW_BUTTON_LABEL = ROW_BUTTON_LABEL
    exports.ROW_BUTTON_LABEL_OFF = ROW_BUTTON_LABEL_OFF
    exports.SIDEBAR_SLOT_SELECTOR = SIDEBAR_SLOT_SELECTOR
    exports.WORKSPACE_ROW_SELECTOR = WORKSPACE_ROW_SELECTOR
    exports.FALLBACK_SETTLE_MS = FALLBACK_SETTLE_MS
    exports.readDialog = readDialog
    exports.subscribeDialog = subscribeDialog
    exports.openWorkdirsDialog = openWorkdirsDialog
    exports.closeWorkdirsDialog = closeWorkdirsDialog
    exports.readHostState = readHostState
    exports.subscribeHostState = subscribeHostState
    exports.publishHostPayload = publishHostPayload
    exports.isEnabledWorkspace = isEnabledWorkspace
    exports.SOURCE_NAME = SOURCE_NAME
    exports.SOURCE_SECTION = SOURCE_SECTION
    exports.samePath = samePath
    exports.sessionCwd = sessionCwd
    exports.workspaceForSession = workspaceForSession
    exports.parseLabelValue = parseLabelValue
    exports.createLabelSource = createLabelSource
    exports.labelSourceStatus = labelSourceStatus
    exports.selectWorkspace = selectWorkspace
    exports.isOutside = isOutside
    exports.basenameOf = basenameOf
    exports.suggestLabel = suggestLabel
    exports.draftAfterPick = draftAfterPick
    exports.pickErrorMessage = pickErrorMessage
    exports.installWorkspaceRowButtons = installWorkspaceRowButtons
    exports.seatRowButton = seatRowButton
    exports.markRowButton = markRowButton
    exports.WorkdirsPanelIcon = WorkdirsPanelIcon
    exports.WorkdirsEntryIcon = WorkdirsEntryIcon
    exports.WorkdirsDialog = WorkdirsDialog
    exports.WorkdirsHintPanel = WorkdirsHintPanel
    exports.WorkspacePlusSettings = WorkspacePlusSettings
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
