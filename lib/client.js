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
 *   `plugins.row.config`  the `workspace+` settings page, now the `workspaceplus`
 *                         row's configuration page on the plugin detail page
 *                         instead of a section of the product's Settings page.
 *                         It owns one preference per Workspace — whether the
 *                         feature runs there — and the default (first-use)
 *                         Workspace starts off because it belongs to the product.
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
 *                         read and the switch itself lives on that row's
 *                         settings page.
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
 *   the delete intercept  the sixth seat. Deleting a Workspace leaves its
 *                         Sessions unaccounted — the sidebar files them under
 *                         「未分组」 — so a capture-click on the shell's own
 *                         「删除工作区」 confirmation opens a question of this
 *                         plugin's: archive those conversations first, or delete
 *                         them as usual. Archiving is gated behind a long press
 *                         and, when chosen, happens before the intercepted
 *                         click is replayed, so the shell still owns the delete.
 *                         A dialog this plugin cannot prove is that confirmation
 *                         is left alone.
 *
 * The 通知 (notice) sub-feature — ported from the dsh-notice plugin, which now
 * ships as the `dsh-workspace-plus/notice` loader row of this same bundle — adds
 * two more seats here, described in detail at its section below:
 *
 *   `plugins.row.config`  the 通知 settings page, opened from the `notice` row
 *                         on the plugin detail page, writing through the same
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
    const ReactDOM = require('react-dom/client')
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
     * Where this plugin's settings live: its own pages on the plugin detail
     * page, not sections of the product's Settings navigation.
     *
     * `plugins.row.config` is a KEYED slot, keyed by
     * `<package name>#<row id>` exactly as `cordis.patch.yml` declares the row.
     * Occupying it gives that row a configure control in the bundle's
     * "included components" list; the control opens the entry's page, headed by
     * the row's own title and description. It is the same seat dsh-ops puts its
     * switches in, and it keeps a plugin's preferences out of Settings.
     */
    const PACKAGE_NAME = 'dsh-workspace-plus'
    const ROW_CONFIG_SLOT = 'plugins.row.config'
    const WORKSPACE_ROW_ID = 'workspaceplus'
    const NOTICE_ROW_ID = 'notice'
    const WORKSPACE_ROW_CONFIG_KEY = PACKAGE_NAME + '#' + WORKSPACE_ROW_ID
    const NOTICE_ROW_CONFIG_KEY = PACKAGE_NAME + '#' + NOTICE_ROW_ID

    /**
     * Settings keys this page owns.
     *
     * `WORKSPACE_ENABLED_SETTING` is the per-workspace layer the row settings
     * page actually writes: one switch per workspace, keyed by the workspace key the
     * host publishes in its snapshot. `DEFAULT_WORKSPACE_SETTING` is the default
     * that layer falls back to for the default Workspace, and is read only.
     */
    const DEFAULT_WORKSPACE_SETTING = 'defaultWorkspaceEnabled'
    const WORKSPACE_ENABLED_SETTING = 'workspaceEnabled'

    /**
     * The sidebar workspace-sort switch. On by default, in the Host and here:
     * a folder that just started a conversation belongs at the top of the
     * Workspace list, and the switch exists for anyone who would rather drag
     * folders into their own order and keep it.
     */
    const SORT_WORKSPACES_SETTING = 'sortWorkspacesByRecent'

    /**
     * The sidebar-sort cooldown, in minutes.
     *
     * A conversation the user is still iterating on must not re-sort its folder
     * on every follow-up message, so the window is measured from the end of that
     * conversation's AI reply: a send inside it is the same work, the first send
     * after it is new work and moves the folder again.
     */
    const SORT_COOLDOWN_SETTING = 'sortWorkspaceCooldownMinutes'

    /** Cooldown the page uses when the Host publishes nothing usable. */
    const SORT_COOLDOWN_DEFAULT_MINUTES = 5

    /**
     * The folded-workspace list switch. On by default: a folded folder that
     * still shows its working conversations is what keeps the sidebar short
     * without hiding activity, and the switch turns the seat off entirely.
     */
    const SHOW_ACTIVE_SETTING = 'showActiveSessionsWhenCollapsed'

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
    //   the 通知 settings page — now the `notice` row's configuration page on
    //   the plugin detail page, writing through the SAME routes as before
    //   (`/dsh-notice/api`). When the notice row is disabled the host answers
    //   404, the page renders that state, and nothing else is affected.
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

    /**
     * The 通知 page is the `notice` row's configuration page: its slot key is
     * `NOTICE_ROW_CONFIG_KEY`, declared with the other row identities above.
     */

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
     * The 通知 settings page, now the `notice` row's configuration page on the
     * plugin detail page (it was a Settings section when dsh-notice owned it).
     * Every switch writes immediately; the host
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
              '通知子功能当前未启用：回到插件详情页，打开 notice 这一行的开关即可启用。',
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

      // How a click is actually delivered, as the host reports it after
      // registering the protocol. The host prefers a compiled windowless
      // helper and falls back to windowless PowerShell, then to plain
      // PowerShell, so the status line names the mode instead of promising the
      // best case. The helper restores and focuses the window itself, but only
      // when `focusOnClick` is on — with the switch off the host registers the
      // same helper without that step — so the sentence must not claim a
      // foreground window in that state. A host that predates `launcher` has no
      // value here, and then this returns '' so the sentence reads exactly as
      // it did before.
      const launcherNote = (() => {
        const focus = settings.focusOnClick === true
        if (protocol.launcher === 'helper') {
          return focus ? '点击助手会在无窗口的情况下把 Harness 切到前台' : '由无窗口的点击助手处理，不改变窗口的前后顺序'
        }
        if (protocol.launcher === 'windowless-powershell') {
          return focus
            ? '使用无窗口 PowerShell 助手，由 Harness 负责切到前台；首次点击可能稍慢'
            : '使用无窗口 PowerShell 助手；首次点击可能稍慢'
        }
        if (protocol.launcher === 'powershell') return '兼容模式：由 PowerShell 启动，可能有窗口闪烁'
        return ''
      })()

      const protocolLine = (() => {
        if (protocol.registered === true) {
          return launcherNote
            ? `点击通知可打开对应对话（已注册 ${protocol.scheme}:，${launcherNote}）。`
            : `点击通知可打开对应对话（已注册 ${protocol.scheme}:）。`
        }
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
            description: '开启后点击通知会尽量把窗口从最小化、被遮挡或收进托盘的状态恢复并切到前台；关闭则只切换对话，不改变窗口的前后顺序。',
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

      // Report the origin once, to tell the host a page is up. It is a hint, not
      // the listen port: this page is served from the application's own
      // `dsh-app://app` scheme, which names no port, and the Host learns its own
      // from the listener it just bound (see the host half's syncWhenPortKnown).
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
     * Class marking that same button on a workspace the row settings page
     * switched off. The button stays — the dialog is the only place a workspace's labels
     * can be read — but it draws dimmed and says why in its tooltip.
     */
    const ROW_BUTTON_OFF_CLASS = 'dsh-workspace-plus-rowbtn-off'

    /** Label of the injected row button. */
    const ROW_BUTTON_LABEL = '工作区目录设置'

    /** Label of that button where workspace+ is switched off for the workspace. */
    const ROW_BUTTON_LABEL_OFF = '工作区目录设置（这个工作区已在 workspace+ 里停用）'

    /**
     * The product's own icons, which is what this plugin draws everywhere.
     *
     * Nothing here is redrawn: the folder, the plus, the cross and the shield are
     * the very components the shell renders beside them, taken from
     * `@deepseek-ai/dsh-client-ui-primitives` at run time. A copied path would be
     * a second source of truth that silently drifts from the product's artwork,
     * and a missing export simply falls back to the product's own text/omission
     * instead of a lookalike.
     */
    const P = primitives ?? {}

    /** The folder icon the shell puts on an expanded workspace row. */
    const IconFolderOpen = P.IconFolderOpenRegular
    /** The folder icon the shell puts on a collapsed workspace row. */
    const IconFolderClose = P.IconFolderCloseRegular
    /** The shell's cross, for a row's remove control. */
    const IconClose = P.IconCloseOutlineRegular
    /** The shell's plus, for the add row. */
    const IconPlus = P.IconPlusOutlineRegular
    /** The shell's shield, for the "outside the workspace" badge. */
    const IconShield = P.IconShieldOutlineRegular

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
.dsh-workspace-plus-control{display:flex;flex:none;align-items:center;gap:8px}
.dsh-workspace-plus-settings-unit{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dsh-workspace-plus-number{box-sizing:border-box;width:76px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dsh-workspace-plus-number:disabled{opacity:.55}
.dsh-workspace-plus-number:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.dsh-workspace-plus-cooldown-error{color:var(--dsw-alias-state-error-primary);margin-top:4px;font-size:12px;line-height:18px}
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
.dsh-workspace-plus-archive-delete{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsh-workspace-plus-archive-note{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-workspace-plus-archive-progress{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dsh-workspace-plus-archive-error{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
/* The destructive confirm asks for a deliberate press: a wide, quiet outline
   button whose fill rises while the pointer is down, plus the shell's focus
   ring so it stays reachable from the keyboard. */
.dsh-workspace-plus-hold{position:relative;overflow:hidden;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 16px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-sm,8px);background:0 0;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:13px;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none}
.dsh-workspace-plus-hold:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dsh-workspace-plus-hold:disabled{cursor:default;opacity:.5}
.dsh-workspace-plus-hold:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dsh-workspace-plus-hold-fill{position:absolute;top:0;bottom:0;left:0;width:0;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);pointer-events:none}
.dsh-workspace-plus-hold-label{position:relative;z-index:1;white-space:nowrap}
.dsh-workspace-plus-hold[data-holding="true"] .dsh-workspace-plus-hold-label{color:var(--dsw-alias-state-error-primary)}
@keyframes dsh-workspace-plus-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-workspace-plus-card{animation:none}}
/* A folded group keeps the shell's own Session rows; only the idle ones are filtered out. */
.dsh-workspace-plus-folded [data-row-key^="session:"]:not([data-dsh-workspace-plus-active="1"]){display:none}
.dsh-workspace-plus-folded [data-row-key^="overflow:"]{display:none}
.dsh-workspace-plus-folded [role="group"] [data-row-key^="workspace:"]{display:none}
/* The row still renders the open-folder icon from React state; a folded row
   shows the product's own closed-folder icon (mounted through React) instead. */
.dsh-workspace-plus-folded-row > :first-child > :not(.dsh-workspace-plus-closed-folder){display:none}
.dsh-workspace-plus-folded-row > .dsh-workspace-plus-closed-folder,
.dsh-workspace-plus-folded-row > :first-child > .dsh-workspace-plus-closed-folder{display:inline-flex}
.dsh-workspace-plus-folded-row > :first-child > .dsh-workspace-plus-closed-folder{display:inline-flex;align-items:center;justify-content:center}
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
     * One of the product's icons, with this plugin's click seat when the icon is
     * itself a control.
     *
     * @param props - the product icon component, its size, an optional class, and
     *   the click handler when the glyph is a button.
     * @returns the icon element, or null when the shell does not export it.
     */
    function ProductGlyph({ icon, size = 16, className = 'dsh-workspace-plus-glyph', onClick }) {
      if (typeof icon !== 'function') return null
      return React.createElement(icon, {
        size,
        className,
        ...(onClick === undefined ? {} : { onClick }),
      })
    }

    /**
     * The folder-open icon, so the fallback sidebar entry, the hint panel, and the
     * dialog's directory rows all draw the same icon the shell uses on its
     * workspace row.
     *
     * @param props - optional size, free-form class, and the click handler when
     *   the glyph is itself a control.
     * @returns the icon element.
     */
    function FolderGlyph({ size = 16, className, onClick }) {
      return React.createElement(ProductGlyph, { icon: IconFolderOpen, size, className, onClick })
    }

    /** The row's remove control: the shell's cross. */
    function CloseGlyph({ size = 16 }) {
      return React.createElement(ProductGlyph, { icon: IconClose, size })
    }

    /** The add row's leading glyph: the shell's plus. */
    function PlusGlyph({ size = 16 }) {
      return React.createElement(ProductGlyph, { icon: IconPlus, size })
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
     * surfaces: the row settings page renders one switch per workspace from it, the
     * row installer consults the per-workspace `enabled` flag, and the dialog
     * refreshes it after every mutation.
     */
    let hostState = {
      known: false,
      settings: {
        [DEFAULT_WORKSPACE_SETTING]: false,
        [WORKSPACE_ENABLED_SETTING]: {},
        [SORT_WORKSPACES_SETTING]: true,
        [SORT_COOLDOWN_SETTING]: SORT_COOLDOWN_DEFAULT_MINUTES,
        [SHOW_ACTIVE_SETTING]: true,
      },
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
          // A Host that predates the switch, or a page that reads a stale
          // snapshot, keeps the feature on: that is the shipped default.
          [SORT_WORKSPACES_SETTING]: payload.settings?.[SORT_WORKSPACES_SETTING] !== false,
          [SORT_COOLDOWN_SETTING]: readCooldownMinutes(payload.settings?.[SORT_COOLDOWN_SETTING]),
          [SHOW_ACTIVE_SETTING]: payload.settings?.[SHOW_ACTIVE_SETTING] !== false,
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
    // Sidebar Workspace ordering: the folder with the newest conversation first
    //
    // The sidebar's Workspace (folder) order IS the Host workspace-registry
    // order — dragging a folder on the shell's own row calls
    // `workspaces.insertBefore`, the same public command used here. Reordering
    // through that command is therefore the whole feature: the shell re-renders
    // its rows itself, the order is the one the Host persists, and this plugin
    // never moves a sidebar DOM node.
    //
    // A folder only moves when a conversation in it really starts working: the
    // blank "new conversation" placeholder does not count, a send whose turn
    // starts in a folder that already has another conversation running is
    // ignored, and one piece of work moves its folder at most once per cooldown
    // window (measured from the end of that conversation's AI reply). The sort
    // key itself is each Workspace's newest Session `updatedAt` — the only
    // timestamp the client projection carries — and Workspaces with no Session
    // (or only archived ones) trail in their existing relative order, as do ties.
    // -----------------------------------------------------------------------

    /**
     * Quiet period after the last session/workspace event before an order is
     * committed. Session streams arrive in bursts (one turn writes several
     * events) and every commit is a Host round trip, so one debounce covers a
     * whole exchange.
     */
    const WORKSPACE_SORT_DEBOUNCE_MS = 300

    /**
     * Whether the sidebar workspace-sort switch is on.
     *
     * A snapshot that predates the switch, or one that has not arrived yet,
     * reads as "on": the switch defaults to on in the Host, and a page that
     * cannot read the setting should do what a fresh install does rather than
     * silently disable the feature.
     *
     * @returns true when the Workspace list should follow recency.
     */
    function isWorkspaceSortEnabled() {
      return readHostState().settings[SORT_WORKSPACES_SETTING] !== false
    }

    /**
     * Validate one cooldown value the way the Host does.
     *
     * @param value - a Host snapshot value, or anything else.
     * @returns integer minutes in range, or null when unusable.
     */
    function readCooldownMinutes(value) {
      if (typeof value !== 'number' || !Number.isInteger(value)) return null
      if (value < 0 || value > 1440) return null
      return value
    }

    /**
     * The sort cooldown in milliseconds.
     *
     * @returns the configured window, or the shipped default when the Host
     *   snapshot carries nothing usable.
     */
    function sortCooldownMs() {
      const minutes = readCooldownMinutes(readHostState().settings[SORT_COOLDOWN_SETTING])
      return (minutes === null ? SORT_COOLDOWN_DEFAULT_MINUTES : minutes) * 60 * 1000
    }

    /**
     * The newest Session time of one Workspace.
     *
     * Archived Sessions are skipped: archiving is putting a conversation away,
     * not using its folder. A Workspace whose Sessions are all archived ranks
     * with the Workspaces that have none.
     *
     * @param workspace - one `workspaces.list` row (its `sessionIds`).
     * @param summaries - the `sessions.list` `byId` map.
     * @param archived - the archive set as a Set.
     * @returns epoch milliseconds, or null when nothing ranks.
     */
    function newestSessionTime(workspace, summaries, archived) {
      const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
      let newest = null
      for (const id of ids) {
        if (archived.has(id)) continue
        const summary = summaries?.[id]
        // A blank Session is the "new conversation" placeholder: it exists
        // before any message is written, so it must not rank its folder (and
        // clicking that button must not move anything).
        if (summary === undefined || summary.blank === true) continue
        const at = summary.updatedAt
        if (typeof at !== 'number' || Number.isNaN(at)) continue
        if (newest === null || at > newest) newest = at
      }
      return newest
    }

    /**
     * Workspace ids ordered by their newest conversation, most recent first.
     *
     * The projection is total: every input id comes back exactly once. Rows with
     * no ranking Session keep their existing relative order at the tail, and ties
     * keep the order the Host already had — a partially loaded session list can
     * only ever make the result less precise, never random.
     *
     * @param workspaces - `workspaces.list` items, in Host order.
     * @param sessions - the `sessions.list` snapshot.
     * @param archivedSessionIds - the projection's archive set.
     * @returns the target Workspace order.
     */
    function orderWorkspacesByRecency(workspaces, sessions, archivedSessionIds) {
      const summaries = sessions?.byId ?? {}
      const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
      const rows = workspaces.map((workspace, index) => ({
        id: workspace.workspaceId,
        at: newestSessionTime(workspace, summaries, archived),
        index,
      }))
      const ranked = rows.filter((row) => row.at !== null)
      const rest = rows.filter((row) => row.at === null)
      ranked.sort((left, right) => right.at - left.at || left.index - right.index)
      return [...ranked, ...rest].map((row) => row.id)
    }

    /**
     * Compact activity projection of every Session, kept between passes so the
     * next pass can tell "the user just sent something" from "nothing changed".
     *
     * @param summaries - the `sessions.list` `byId` map.
     * @returns sessionId -> `{ running, updatedAt, blank }`.
     */
    function rememberSessions(summaries) {
      const remembered = {}
      for (const [id, summary] of Object.entries(summaries ?? {})) {
        if (summary === null || typeof summary !== 'object') continue
        remembered[id] = {
          running: summary.running === true,
          updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : null,
          blank: summary.blank === true,
        }
      }
      return remembered
    }

    /**
     * Compare two activity projections and report what changed.
     *
     * A "start" is a blank placeholder that just became a real conversation (its
     * first message), a running flag that flipped on, a message time that
     * advanced, or a Session seen for the first time while it is already working.
     * A "reply end" is a running flag that flipped off, or a turn that finished
     * between two passes (the time advanced while idle).
     *
     * Starts are the only thing that may move a folder; reply ends are what arm
     * the cooldown window, which is why both are reported.
     *
     * @param previous - the projection remembered from the last pass.
     * @param summaries - the current `sessions.list` `byId` map.
     * @returns `{ started, ended }` as arrays of Session ids.
     */
    function sessionTransitions(previous, summaries) {
      const started = new Set()
      const ended = new Set()
      const remembered = previous ?? {}
      for (const [id, summary] of Object.entries(summaries ?? {})) {
        if (summary === null || typeof summary !== 'object') continue
        const before = remembered[id]
        const running = summary.running === true
        const blank = summary.blank === true
        if (before === undefined) {
          // Seen for the first time: only count it while it is working, so a
          // lazily paged-in old conversation cannot lift its folder.
          if (!blank && running) started.add(id)
          continue
        }
        const wrote = !blank && (
          before.blank === true
          || (typeof summary.updatedAt === 'number'
            && typeof before.updatedAt === 'number'
            && summary.updatedAt > before.updatedAt)
        )
        if (wrote) started.add(id)
        if (before.running !== true && running) started.add(id)
        if (before.running === true && !running) ended.add(id)
        else if (wrote && !running) ended.add(id)
      }
      return { started: [...started], ended: [...ended] }
    }

    /**
     * The Workspace one Session belongs to.
     *
     * Membership is authoritative; the cwd is the fallback for a Session the
     * Workspace projection has not accounted for yet.
     *
     * @param workspaces - `workspaces.list` items.
     * @param sessionId - the Session in question.
     * @param summary - its Session row (its `cwd`).
     * @returns the Workspace row, or null.
     */
    function workspaceOfSession(workspaces, sessionId, summary) {
      for (const workspace of workspaces) {
        if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) return workspace
      }
      const cwd = summary?.cwd
      if (typeof cwd !== 'string' || cwd === '') return null
      for (const workspace of workspaces) {
        if (typeof workspace?.path === 'string' && samePath(workspace.path, cwd)) return workspace
      }
      return null
    }

    /**
     * Whether a Workspace has another Session working right now.
     *
     * The conversation that just started is excluded: it is always running at
     * that moment, and the rule is about the folder being busy with something
     * else.
     *
     * @param workspace - the Workspace row.
     * @param summaries - the current `sessions.list` `byId` map.
     * @param exceptSessionId - the conversation that triggered the check.
     * @returns true when another Session in that folder is working.
     */
    function folderHasRunningSession(workspace, summaries, exceptSessionId) {
      const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
      for (const id of ids) {
        if (id === exceptSessionId) continue
        if (summaries?.[id]?.running === true) return true
      }
      return false
    }

    /**
     * The `insertBefore` moves that turn `currentIds` into `targetIds`, in the
     * order they must run.
     *
     * Each move is simulated against the list it produces, so a row that has to
     * travel several places is moved once, straight to its target slot. Ids the
     * current order does not carry are skipped rather than invented.
     *
     * @param currentIds - the order the Host projects right now.
     * @param targetIds - the order the sort wants.
     * @returns the moves, `{ workspaceId, beforeWorkspaceId }`, in run order.
     */
    function workspaceMoves(currentIds, targetIds) {
      const current = [...currentIds]
      const moves = []
      for (let target = 0; target < targetIds.length; target += 1) {
        const id = targetIds[target]
        const at = current.indexOf(id)
        if (at === -1 || at === target) continue
        moves.push({ workspaceId: id, beforeWorkspaceId: current[target] })
        current.splice(at, 1)
        current.splice(target, 0, id)
      }
      return moves
    }

    /**
     * Keep the sidebar Workspaces ordered by recency, for as long as the switch
     * is on.
     *
     * Both services are optional by contract: a composition without the Session
     * projection, or without the Workspace controller, simply never reorders.
     * Every failure is swallowed on purpose — an order is a nicety, and a refused
     * move must not surface as an error in the middle of a conversation.
     *
     * @param services - `{ workspaces, sessions }`, plus an optional debounce.
     * @returns `{ dispose }`.
     */
    function installWorkspaceOrdering({
      workspaces,
      sessions,
      debounceMs = WORKSPACE_SORT_DEBOUNCE_MS,
      now = () => Date.now(),
    }) {
      let disposed = false
      let timer = null
      let applying = false
      let queued = false
      /** The last target order this page committed; repeating it would fight a drag. */
      let lastTargetKey = null
      /** The activity projection the last pass saw, so this pass can diff it. */
      let previous = {}
      /**
       * False until the first ready pass has recorded its baseline. Opening DSH
       * itself never reorders — the Host order is the one the list starts with.
       */
      let primed = false
      /** The switch's value at the last pass, so off -> on can align once. */
      let wasEnabled = isWorkspaceSortEnabled()
      /** sessionId -> when that conversation's last AI reply ended (epoch ms). */
      const lastReplyEndedAt = new Map()

      /**
       * Read the Workspace projection, or null when it cannot be read or holds
       * fewer than two rows (a single Workspace has nothing to reorder).
       *
       * @returns the snapshot, or null.
       */
      const readWorkspaces = () => {
        try {
          const snapshot = workspaces?.list?.getSnapshot?.()
          if (snapshot === null || snapshot === undefined) return null
          if (!Array.isArray(snapshot.items) || snapshot.items.length < 2) return null
          return snapshot
        } catch {
          return null
        }
      }

      /**
       * Read the Session projection, or null when it cannot be read.
       *
       * @returns the snapshot, or null.
       */
      const readSessions = () => {
        try {
          const snapshot = sessions?.list?.getSnapshot?.()
          return snapshot !== null && typeof snapshot === 'object' ? snapshot : null
        } catch {
          return null
        }
      }

      /**
       * Whether one conversation that just started work may move its folder.
       *
       * Three gates, in the order the user asked for them:
       *
       *  1. the Session must not be blank — clicking "new conversation" creates
       *     one, and that alone must never reorder anything;
       *  2. no OTHER Session in the same Workspace may be running — that folder
       *     is already the one being worked in, so the order is left alone;
       *  3. the send must not fall inside the cooldown window measured from the
       *     end of this conversation's last AI reply — inside it the user is
       *     still iterating on the same piece of work.
       *
       * @param sessionId - the Session whose turn just started.
       * @param sessionSnapshot - the Session projection.
       * @param workspaceSnapshot - the Workspace projection.
       * @returns true when the order should be recomputed.
       */
      const shouldSortFor = (sessionId, sessionSnapshot, workspaceSnapshot) => {
        const summary = sessionSnapshot.byId?.[sessionId]
        if (summary === undefined || summary.blank === true) return false
        const workspace = workspaceOfSession(workspaceSnapshot.items, sessionId, summary)
        if (workspace === null) return false
        if (folderHasRunningSession(workspace, sessionSnapshot.byId, sessionId)) return false
        const endedAt = lastReplyEndedAt.get(sessionId)
        if (endedAt === undefined) return true
        return now() - endedAt >= sortCooldownMs()
      }

      /** Evaluate the projections and commit at most one order. */
      const applyOrder = async () => {
        if (disposed || applying) return
        const workspaceSnapshot = readWorkspaces()
        const sessionSnapshot = readSessions()
        if (workspaceSnapshot === null || sessionSnapshot === null) return
        // Wait for both projections to arrive: ordering against a partial list
        // would move a Workspace out of a position its folder has not been read
        // into yet.
        if (workspaceSnapshot.phase !== undefined && workspaceSnapshot.phase !== 'ready') return
        if (sessionSnapshot.phase !== undefined && sessionSnapshot.phase !== 'ready') return

        const enabled = isWorkspaceSortEnabled()
        // Turning the switch on is an explicit request to align the list; opening
        // DSH is not, so the first ready pass only records its baseline.
        const justEnabled = enabled && wasEnabled === false
        wasEnabled = enabled

        const summaries = sessionSnapshot.byId ?? {}
        const transitions = sessionTransitions(previous, summaries)
        previous = rememberSessions(summaries)

        let commit = false
        if (enabled) {
          if (justEnabled) {
            commit = true
          } else if (primed === true && transitions.started.length > 0) {
            // Decide before recording this pass's reply ends: the send that just
            // started a turn is judged against the PREVIOUS reply's end.
            commit = transitions.started.some((id) => shouldSortFor(id, sessionSnapshot, workspaceSnapshot))
          }
        }
        // Reply ends are recorded even while the switch is off, so the cooldown
        // is accurate the moment it comes back on.
        const endedAt = now()
        for (const id of transitions.ended) lastReplyEndedAt.set(id, endedAt)
        primed = true
        if (commit === false) return

        const currentIds = workspaceSnapshot.items.map((workspace) => workspace.workspaceId)
        const targetIds = orderWorkspacesByRecency(
          workspaceSnapshot.items,
          sessionSnapshot,
          workspaceSnapshot.archivedSessionIds,
        )
        // One commit per target order. Without this, a commit that the Host
        // answers without changing the order would be retried forever, and a
        // folder the user just dragged would be pulled back on the next idle
        // pass instead of on the next conversation.
        const targetKey = targetIds.join('\u0000')
        if (targetKey === lastTargetKey) return
        lastTargetKey = targetKey
        const moves = workspaceMoves(currentIds, targetIds)
        if (moves.length === 0) return
        applying = true
        try {
          for (const move of moves) {
            if (disposed || !isWorkspaceSortEnabled()) break
            const result = await Promise.resolve(workspaces.insertBefore(move.workspaceId, move.beforeWorkspaceId))
            if (result !== null && typeof result === 'object' && result.ok === false) break
          }
        } catch {
          // A refused or failed move leaves the Host order alone; the next event
          // retries from whatever order the Host actually holds.
        } finally {
          applying = false
          if (queued) {
            queued = false
            schedule()
          }
        }
      }

      /** Debounce one recomputation. */
      function schedule() {
        if (disposed) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void applyOrder()
        }, debounceMs)
      }

      /**
       * Store notification: our own commits move the Workspace list too, so a
       * notification that lands mid-commit is folded into one trailing pass.
       */
      const onNotification = () => {
        if (applying) {
          queued = true
          return
        }
        schedule()
      }

      const disposers = []
      const listen = (subscribe) => {
        if (typeof subscribe !== 'function') return
        try {
          const off = subscribe(onNotification)
          if (typeof off === 'function') disposers.push(off)
        } catch {
          // An unusable store just leaves the order alone.
        }
      }
      listen((listener) => sessions?.list?.subscribe?.(listener))
      listen((listener) => workspaces?.list?.subscribe?.(listener))
      listen(subscribeHostState)
      schedule()

      return {
        dispose() {
          disposed = true
          if (timer !== null) clearTimeout(timer)
          timer = null
          for (const off of disposers.splice(0)) {
            try {
              off()
            } catch {
              // Disposal must not throw on a store that already went away.
            }
          }
        },
      }
    }

    // -----------------------------------------------------------------------
    // Folded Workspaces: working conversations stay visible
    //
    // The shell's fold unmounts every Session row in the group — and with the
    // rows, the native hover menu, hover card, row actions and selected state.
    // This seat keeps the group expanded in the shell and presents the fold
    // itself: idle Session rows are filtered out with CSS, working ones stay,
    // and every surviving row keeps the shell's own behavior.
    //
    // A click on a folder row is captured before the shell's handler and turned
    // into this visual fold; a group with nothing to surface still collapses
    // natively. The folded set is browser-local, so a reload keeps it.
    // -----------------------------------------------------------------------

    /** Class on the group section whose idle Session rows are filtered out. */
    const FOLDED_SECTION_CLASS = 'dsh-workspace-plus-folded'

    /** Class on the folder row while that section is folded. */
    const FOLDED_ROW_CLASS = 'dsh-workspace-plus-folded-row'

    /** Attribute on a native Session row that must stay visible in a folded group. */
    const ACTIVE_ROW_ATTRIBUTE = 'data-dsh-workspace-plus-active'

    /** Browser-local folded-workspace set. */
    const FOLDED_STORAGE_KEY = 'dsh-workspace-plus.folded.v1'

    /** Marker class on the closed-folder icon a folded row swaps in. */
    const CLOSED_FOLDER_CLASS = 'dsh-workspace-plus-closed-folder'

    /** Icon host element -> the React root rendering into it, so folds unmount cleanly. */
    const mountedGlyphs = new WeakMap()

    /** Unmount one swapped-in icon, if it is still mounted. */
    function releaseGlyph(element) {
      const root = element === null || element === undefined ? undefined : mountedGlyphs.get(element)
      if (root === undefined) {
        if (element !== null && element !== undefined && typeof element.remove === 'function') element.remove()
        return
      }
      mountedGlyphs.delete(element)
      try {
        root.unmount()
      } catch {
        // An already-unmounted root simply has nothing left to release.
      }
      if (typeof element.remove === 'function') element.remove()
    }

    /**
     * Whether the folded-workspace behavior is switched on.
     *
     * @returns true unless the host snapshot says the user turned it off.
     */
    function isActiveSessionsShown() {
      return readHostState().settings[SHOW_ACTIVE_SETTING] !== false
    }

    /**
     * Mount the shell's own closed-folder icon into a folded row's folder slot.
     *
     * The row's artwork comes from React state, which still believes the group
     * is expanded, so the open folder would stay on screen. Rather than drawing
     * a second folder, this reuses the product's `IconFolderCloseRegular` — the
     * very component ProjectRowItem renders for an actually-collapsed group —
     * through the product's own renderer.
     *
     * @param slot - the row's folder slot.
     * @returns the created element, or null when it could not be rendered.
     */
    function closedFolderGlyph(slot) {
      if (typeof document === 'undefined' || typeof ReactDOM?.createRoot !== 'function') return null
      const host = document.createElement('span')
      host.className = CLOSED_FOLDER_CLASS
      try {
        const icon = primitives?.IconFolderCloseRegular
        if (icon === undefined) return null
        const root = ReactDOM.createRoot(host)
        root.render(React.createElement(icon, {}))
        mountedGlyphs.set(host, root)
        return host
      } catch {
        return null
      }
    }

    /** Fold a path for the ancestor test: separators, trailing slash, case. */
    function foldedPath(value) {
      return String(value).replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
    }

    /** Whether `child` is a directory inside `parent` (never equal). */
    function isPathInside(child, parent) {
      if (typeof child !== 'string' || typeof parent !== 'string') return false
      const inside = foldedPath(child)
      const root = foldedPath(parent)
      return inside !== '' && root !== '' && inside !== root && inside.startsWith(root + '\\')
    }

    /**
     * Every Session id a Workspace owns, including its registered descendants.
     *
     * @param workspace - one `workspaces.list` row.
     * @param workspaces - all rows, in Host order.
     * @returns the ids, as a Set.
     */
    function workspaceSubtreeSessionIds(workspace, workspaces) {
      const ids = new Set()
      if (workspace === null || typeof workspace !== 'object') return ids
      const collect = (item) => {
        if (item === null || typeof item !== 'object' || !Array.isArray(item.sessionIds)) return
        for (const id of item.sessionIds) if (typeof id === 'string' && id !== '') ids.add(id)
      }
      collect(workspace)
      for (const candidate of Array.isArray(workspaces) ? workspaces : []) {
        if (candidate === workspace) continue
        if (candidate !== null && typeof candidate === 'object' && isPathInside(candidate.path, workspace.path)) {
          collect(candidate)
        }
      }
      return ids
    }

    /**
     * The Sessions a folded group must keep visible.
     *
     * Running (including a running subagent), waiting on the user, unread
     * completion, and every Session the reader clicked while its folder was
     * folded. The clicked ones stay until the folder is unfolded, because
     * opening a completion clears exactly the status that put the row there.
     *
     * @param options - the Session projection, the status source, the archive
     *   set, and the clicked set.
     * @returns the Session ids to keep, as a Set.
     */
    function activeSessionIds({ sessions, statuses, archivedSessionIds, stickySessionIds }) {
      const ids = new Set()
      const summaries = sessions?.byId ?? {}
      const archived =
        archivedSessionIds !== null && typeof archivedSessionIds === 'object' && typeof archivedSessionIds.has === 'function'
          ? archivedSessionIds
          : new Set()
      const sticky =
        stickySessionIds !== null && typeof stickySessionIds === 'object' && typeof stickySessionIds.has === 'function'
          ? stickySessionIds
          : new Set()
      const projections = sessions?.projectionsBySession ?? {}
      const statusOf = (id) =>
        statuses !== null && typeof statuses === 'object' && typeof statuses.get === 'function'
          ? statuses.get(id)
          : undefined
      const hasRunningSubagent = (sessionId) => {
        const catalog = projections[sessionId]?.values?.subagentCatalog
        if (!Array.isArray(catalog)) return false
        for (const child of catalog) {
          if (child === null || typeof child !== 'object' || typeof child.id !== 'string') continue
          if ((statusOf(child.id)?.running ?? summaries[child.id]?.running) === true) return true
        }
        return false
      }
      for (const [id, summary] of Object.entries(summaries)) {
        if (summary === null || typeof summary !== 'object') continue
        if (summary.blank === true || summary.origin === 'subagent') continue
        if (archived.has(id)) continue
        const status = statusOf(id)
        const pending = status?.pendingInteraction
        // The conversation on screen always keeps its row: opening one from the
        // folded list (or from search) must leave the selected row visible, not
        // hide it under the fold it was opened from.
        const retained = summary.retainedBy
        const current = retained !== null && typeof retained === 'object' && (retained.mainView ?? 0) > 0
        if (
          current ||
          status?.running === true ||
          summary.running === true ||
          status?.completionUnread === true ||
          (pending !== null && typeof pending === 'object') ||
          sticky.has(id) ||
          hasRunningSubagent(id)
        ) {
          ids.add(id)
        }
      }
      return ids
    }

    /** @returns the folded workspace ids stored for this browser. */
    function readFoldedWorkspaces() {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined || window.localStorage === null) return new Set()
        const raw = window.localStorage.getItem(FOLDED_STORAGE_KEY)
        if (typeof raw !== 'string' || raw === '') return new Set()
        const parsed = JSON.parse(raw)
        return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id !== '') : [])
      } catch {
        return new Set()
      }
    }

    /** Persist the folded workspace ids for this browser. */
    function writeFoldedWorkspaces(folded) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined || window.localStorage === null) return
        window.localStorage.setItem(FOLDED_STORAGE_KEY, JSON.stringify([...folded]))
      } catch {
        // Storage can refuse (private mode, quota); the fold then lasts this page only.
      }
    }

    /**
     * Keep a folded Workspace's working Session rows mounted and visible.
     *
     * @param options - the Workspace/Session services and the status source.
     * @returns `{ dispose }`.
     */
    function installCollapsedActiveSessions({ workspaces, sessions, uiSession }) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
        return { dispose() {} }
      }
      const folded = readFoldedWorkspaces()
      const sticky = new Set()
      /** Row -> the section element its fold class was put on. */
      const applied = new Map()
      const attempts = new Map()
      let current = { items: [], active: new Set() }
      let scheduled = false
      let stopped = false
      let programmatic = false

      /** The unified status source, resolved per pass. */
      const statusService = () => {
        try {
          return typeof uiSession === 'function' ? uiSession() : uiSession ?? null
        } catch {
          return null
        }
      }

      /** Read one service projection without letting a stale shape throw. */
      const readSnapshot = (read) => {
        try {
          return read()
        } catch {
          return null
        }
      }

      /** @param row - a workspace group row. @returns its id, or ''. */
      const workspaceIdOf = (row) => (row.getAttribute('data-row-key') ?? '').slice(ROW_KEY_PREFIX.length)

      /** @param row - a Session row. @returns its id, or ''. */
      const sessionIdOf = (row) => (row.getAttribute('data-row-key') ?? '').slice('session:'.length)

      /**
       * The group element one folder row belongs to.
       *
       * The shell does not put the row straight into the group section: when the
       * Workspace has a `createdAt`, ProjectRowItem wraps it in the primitives'
       * HoverCard, which renders a plain `<span>`. That span is the row's
       * parentElement, and it holds nothing but the row — so marking it applied
       * the fold class to an element with no Session rows beneath it. The CSS had
       * nothing to filter, the folder looked "folded" while every idle
       * conversation stayed on screen, and the unfold click then cleared a class
       * nothing had been scoped to. Walk up instead: the section is the first
       * ancestor whose siblings are this group's own rows. The list container is
       * never returned, so a fold can never blank the whole sidebar.
       *
       * @param row - a workspace row.
       * @returns the section element, or null when it cannot be identified.
       */
      const sectionOf = (row) => {
        for (let node = row.parentElement; node !== null && node !== undefined; node = node.parentElement) {
          const parent = node.parentElement
          if (parent === null || parent === undefined) return null
          if (typeof parent.matches === 'function' && parent.matches(SIDEBAR_SLOT_SELECTOR)) return null
          for (const sibling of parent.children) {
            if (sibling === node || typeof sibling.getAttribute !== 'function') continue
            const key = sibling.getAttribute('data-row-key') ?? ''
            if (key.startsWith('session:') || key.startsWith('overflow:') || key === 'empty') return parent
            if (sibling.getAttribute('role') === 'group') return parent
          }
        }
        return null
      }

      /**
       * Fold one row: hide idle Sessions, show the closed folder.
       *
       * @param row - a workspace row.
       * @returns the section the fold class landed on, or null when the group
       *   cannot be identified (then nothing is marked and nothing is filtered).
       */
      const applyFold = (row) => {
        const section = sectionOf(row)
        // Without a section there is nothing to filter: marking the row would
        // only swap its folder for a closed one while every row stayed on
        // screen. The caller falls back to the shell's own collapse.
        if (section === null) return null
        if (typeof section.classList?.add === 'function') section.classList.add(FOLDED_SECTION_CLASS)
        if (typeof row.classList?.add === 'function') row.classList.add(FOLDED_ROW_CLASS)
        if (row.getAttribute('aria-expanded') !== 'false') row.setAttribute('aria-expanded', 'false')
        const slot = row.firstElementChild
        if (slot !== null && slot !== undefined) {
          const drawn = typeof slot.querySelector === 'function' ? slot.querySelector('.' + CLOSED_FOLDER_CLASS) : null
          if (drawn === null) {
            const glyph = closedFolderGlyph(slot)
            if (glyph !== null) slot.appendChild(glyph)
          }
        }
        return section
      }

      /**
       * Unfold one row: restore the shell's expanded row and clear its sticky rows.
       *
       * @param row - a workspace row.
       * @param section - the element applyFold marked, when it is still known.
       */
      const clearFold = (row, section) => {
        const marked = section === undefined ? sectionOf(row) : section
        if (marked !== null && marked !== undefined && typeof marked.classList?.remove === 'function') {
          marked.classList.remove(FOLDED_SECTION_CLASS)
        }
        if (typeof row.classList?.remove === 'function') row.classList.remove(FOLDED_ROW_CLASS)
        if (row.getAttribute('aria-expanded') !== 'true') row.setAttribute('aria-expanded', 'true')
        const slot = row.firstElementChild
        if (slot !== null && slot !== undefined && typeof slot.querySelector === 'function') {
          const glyph = slot.querySelector('.' + CLOSED_FOLDER_CLASS)
          if (glyph !== null) releaseGlyph(glyph)
        }
        const scoped = marked !== null && marked !== undefined ? marked : section
        if (scoped !== null && scoped !== undefined && typeof scoped.querySelectorAll === 'function') {
          for (const sessionRow of scoped.querySelectorAll('[data-row-key^="session:"]')) {
            const id = sessionIdOf(sessionRow)
            if (id !== '') sticky.delete(id)
          }
        }
      }

      /** Whether one Workspace subtree still has something a fold must show. */
      const hasActiveInSubtree = (workspaceId) => {
        let workspace
        for (const candidate of current.items) {
          if (candidate !== null && typeof candidate === 'object' && candidate.workspaceId === workspaceId) {
            workspace = candidate
            break
          }
        }
        if (workspace === undefined) return false
        for (const id of workspaceSubtreeSessionIds(workspace, current.items)) {
          if (current.active.has(id) || sticky.has(id)) return true
        }
        return false
      }

      /**
       * Expand a natively folded group so its rows exist to be filtered. The
       * guard keeps a click that does not take effect from becoming a loop.
       */
      const requestExpand = (row, workspaceId) => {
        const now = Date.now()
        const attempt = attempts.get(workspaceId) ?? { at: 0, count: 0 }
        if (attempt.count >= 5 || now - attempt.at < 1200) return
        attempts.set(workspaceId, { at: now, count: attempt.count + 1 })
        programmatic = true
        try {
          if (typeof row.click === 'function') row.click()
        } catch {
          // A row that refuses the click simply stays folded.
        } finally {
          programmatic = false
        }
      }

      /** Folder clicks become the visual fold; everything else stays native. */
      const onDocumentClick = (event) => {
        if (stopped || programmatic) return
        if (!isActiveSessionsShown()) return
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        if (target.closest('button') !== null) return
        const row = target.closest(WORKSPACE_ROW_SELECTOR)
        if (row === null) return
        const workspaceId = workspaceIdOf(row)
        if (workspaceId === '') return
        if (folded.has(workspaceId)) {
          // A fold this plugin owns always sits on a group the shell still has
          // expanded — that is the whole mechanism: the rows exist so they can
          // be filtered. So unfolding is ours alone; the click must not also
          // reach the shell, or one click would fold and collapse at once and
          // the group would never open again. `aria-expanded` is written by this
          // seat, so it is not a source of truth about the shell's state.
          folded.delete(workspaceId)
          writeFoldedWorkspaces(folded)
          clearFold(row, applied.get(row))
          applied.delete(row)
          schedule()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        // A row the shell itself already collapsed is not ours to fold; the
        // reconcile pass expands it first when it has something to surface.
        if (row.getAttribute('aria-expanded') === 'false') return
        if (!hasActiveInSubtree(workspaceId)) return
        attempts.delete(workspaceId)
        const section = applyFold(row)
        if (section === null) {
          // Nothing was filtered, so this is not a fold: let the shell collapse.
          folded.delete(workspaceId)
          writeFoldedWorkspaces(folded)
          return
        }
        folded.add(workspaceId)
        writeFoldedWorkspaces(folded)
        applied.set(row, section)
        schedule()
        event.preventDefault()
        event.stopPropagation()
      }

      /** A Session row clicked inside a folded group stays visible afterwards. */
      const onDocumentSessionClick = (event) => {
        if (stopped) return
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        const row = target.closest('[data-row-key^="session:"]')
        if (row === null) return
        const section = row.closest('.' + FOLDED_SECTION_CLASS)
        if (section === null) return
        const id = sessionIdOf(row)
        if (id === '') return
        sticky.add(id)
        if (typeof row.setAttribute === 'function') row.setAttribute(ACTIVE_ROW_ATTRIBUTE, '1')
      }

      /** Reconcile the folded sections against the current projections. */
      const reconcile = () => {
        scheduled = false
        if (stopped) return
        const slot = document.querySelector(SIDEBAR_SLOT_SELECTOR)
        if (slot === null) return
        const workspaceSnapshot = readSnapshot(() => workspaces?.list?.getSnapshot?.())
        const sessionSnapshot = readSnapshot(() => sessions?.list?.getSnapshot?.())
        const service = statusService()
        const statuses = service === null ? null : readSnapshot(() => service.sessionStatus?.getSnapshot?.())
        const items = Array.isArray(workspaceSnapshot?.items) ? workspaceSnapshot.items : []
        const archived = new Set(
          Array.isArray(workspaceSnapshot?.archivedSessionIds) ? workspaceSnapshot.archivedSessionIds : [],
        )
        if (sessionSnapshot === null) return
        const active = activeSessionIds({
          sessions: sessionSnapshot,
          statuses,
          archivedSessionIds: archived,
          stickySessionIds: sticky,
        })
        current = { items, active }
        const summaries = sessionSnapshot.byId
        if (summaries !== null && typeof summaries === 'object') {
          for (const id of [...sticky]) if (summaries[id] === undefined) sticky.delete(id)
        }
        for (const row of slot.querySelectorAll('[data-row-key^="session:"]')) {
          const id = sessionIdOf(row)
          if (id !== '' && (active.has(id) || sticky.has(id))) row.setAttribute(ACTIVE_ROW_ATTRIBUTE, '1')
          else if (typeof row.removeAttribute === 'function') row.removeAttribute(ACTIVE_ROW_ATTRIBUTE)
        }
        const rows = [...slot.querySelectorAll(WORKSPACE_ROW_SELECTOR)]
        const live = new Set(rows)
        // A row whose section was rebuilt under it (React re-mounted the group)
        // keeps its state: the remembered section is only dropped when it is no
        // longer the element the row actually sits under.
        for (const [row, section] of [...applied]) {
          if (!live.has(row) || row.isConnected !== true) {
            if (section !== null && section !== undefined && typeof section.classList?.remove === 'function') {
              section.classList.remove(FOLDED_SECTION_CLASS)
            }
            applied.delete(row)
          }
        }
        const enabled = isActiveSessionsShown()
        for (const row of rows) {
          const workspaceId = workspaceIdOf(row)
          if (workspaceId === '') continue
          const section = sectionOf(row)
          const renderedSessions =
            section === null || section === undefined || typeof section.querySelectorAll !== 'function'
              ? 0
              : section.querySelectorAll('[data-row-key^="session:"]').length
          if (enabled && folded.has(workspaceId)) {
            if (renderedSessions === 0) {
              if (hasActiveInSubtree(workspaceId)) requestExpand(row, workspaceId)
              continue
            }
            const focused = applyFold(row)
            if (focused === null) {
              folded.delete(workspaceId)
              writeFoldedWorkspaces(folded)
              continue
            }
            attempts.delete(workspaceId)
            applied.set(row, focused)
            continue
          }
          if (applied.has(row)) {
            clearFold(row, applied.get(row))
            applied.delete(row)
          }
          if (!enabled) continue
          if (row.getAttribute('aria-expanded') === 'false' && hasActiveInSubtree(workspaceId)) {
            folded.add(workspaceId)
            writeFoldedWorkspaces(folded)
            requestExpand(row, workspaceId)
          }
        }
      }

      const schedule = () => {
        if (scheduled || stopped) return
        scheduled = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reconcile)
        else setTimeout(reconcile, 16)
      }

      const observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-expanded', 'data-row-key'],
      })

      document.addEventListener('click', onDocumentClick, true)
      document.addEventListener('click', onDocumentSessionClick, true)

      const disposers = []
      const listen = (subscribe) => {
        if (typeof subscribe !== 'function') return
        try {
          const off = subscribe(schedule)
          if (typeof off === 'function') disposers.push(off)
        } catch {
          // An unusable store just leaves the pass to the DOM observer.
        }
      }
      listen((listener) => sessions?.list?.subscribe?.(listener))
      listen((listener) => workspaces?.list?.subscribe?.(listener))
      listen((listener) => statusService()?.sessionStatus?.subscribe?.(listener))
      listen(subscribeHostState)
      reconcile()

      return {
        dispose() {
          stopped = true
          observer.disconnect()
          document.removeEventListener('click', onDocumentClick, true)
          document.removeEventListener('click', onDocumentSessionClick, true)
          for (const off of disposers.splice(0)) {
            try {
              off()
            } catch {
              // Disposal must not throw on a store that already went away.
            }
          }
          for (const row of applied) clearFold(row)
          applied.clear()
        },
      }
    }

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
     * offer. The row settings page shows this so "the menu has no group" has a visible
     * cause instead of being unfalsifiable.
     */
    let labelSourceRegistered = false

    /**
     * Summarize the `@` source for the row settings page.
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
        React.createElement(ProductGlyph, { icon: IconShield, size: 16 }),
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

      // The switch that turned this workspace off is on the plugin detail page's
      // row settings, not here, so the state is stated where the user is looking.
      const disabledNotice =
        selected === null || selected.enabled !== false
          ? null
          : noticeBlock(
              'warn',
              React.createElement(
                'div',
                { className: 'dsh-workspace-plus-off' },
                '这个工作区已在 workspace+ 里停用：标签不会注入对话，workspace_dirs 工具也会拒绝操作。' +
                  '到插件页 dsh-workspace-plus 的 workspaceplus 行设置里打开它的开关即可恢复。',
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
          const unavailable = state.message.includes('503')
          const unrouted = state.message.includes('404')
          /**
           * The four failures need different advice:
           * - 401: this document never completed the token exchange, so the
           *   connection layer has no authority to admit the request.
           * - 503: the Host has no usable authentication service, so the route
           *   refused the request instead of accepting an unauthenticated
           *   change. Restarting is the ordinary fix; the route stays shut until
           *   the connection service is mounted.
           * - 404: the request reached the Host and nothing claimed the path.
           *   The browser half hot-reloads from the served bundle, the host half
           *   does not, so a stale Host process is the ordinary cause.
           * - anything else: the transport itself (a page with no HTTP carrier).
           */
          const diagnosis = unauthorized
            ? '这个页面没有带授权的会话凭据。请用 `dsh` 启动时打印的带 token 的地址重新打开 GUI（它会写入 cookie，然后跳转到干净地址）。'
            : unavailable
              ? '宿主进程没有可用的认证服务，接口按安全默认拒绝了这次请求（503）。重启 dsh 通常即可恢复；如果一直出现，说明这个宿主没有挂载 connection 认证服务，这个接口在它上面不会放行任何读写。'
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
     * The `workspace+` settings page, registered as the `workspaceplus` row's
     * configuration page (`plugins.row.config`) on the plugin detail page.
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
       * Flip the sidebar workspace-sort switch. It is global — one list, one
       * order — unlike the per-workspace switches below, so it is written as a
       * plain setting and read back through the shared snapshot.
       *
       * @param next - the requested state.
       */
      const toggleSort = async (next) => {
        patch({ busy: true })
        try {
          const result = await postOperation({
            op: 'settings',
            settings: { [SORT_WORKSPACES_SETTING]: next },
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

      const sortEnabled = host.settings[SORT_WORKSPACES_SETTING] !== false
      const sortRow = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-settings-row' },
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-settings-text' },
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-title' },
            '侧栏工作区按最近对话排序',
          ),
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-description' },
            '哪个工作区最近有过对话活动（新开一个或继续旧对话），它就排到侧栏工作区列表的最上面，不用再上下翻找。关掉之后列表保持你手动拖拽的顺序，插件不再自动调整。',
          ),
        ),
        React.createElement(Switch, {
          checked: sortEnabled,
          disabled: state.busy || unavailable,
          label: '侧栏工作区按最近对话排序',
          onChange: (next) => void toggleSort(next),
        }),
      )
      /**
       * Draft of the cooldown field. Every other control on this page writes the
       * moment it flips; a number field needs a commit point, so this is the one
       * control with a 保存 button.
       */
      const configuredCooldown =
        readCooldownMinutes(host.settings[SORT_COOLDOWN_SETTING]) ?? SORT_COOLDOWN_DEFAULT_MINUTES
      const [cooldownDraft, setCooldownDraft] = React.useState(String(configuredCooldown))
      const [cooldownError, setCooldownError] = React.useState('')
      React.useEffect(() => {
        setCooldownDraft(String(configuredCooldown))
      }, [configuredCooldown])

      /**
       * Validate and write the cooldown. The same 0-1440 integer bound the Host
       * enforces is checked here first, so a typo never round-trips. 
       *
       * @param next - the field's current text.
       */
      const commitCooldown = async (next) => {
        const text = String(next).trim()
        const parsed = /^\d+$/.test(text) ? Number(text) : NaN
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) {
          setCooldownError('请输入 0 到 1440 之间的整数分钟数')
          return
        }
        setCooldownError('')
        patch({ busy: true })
        try {
          const result = await postOperation({
            op: 'settings',
            settings: { [SORT_COOLDOWN_SETTING]: parsed },
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

      const cooldownRow = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-settings-row' },
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-settings-text' },
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-title' },
            '同一对话的排序冷却',
          ),
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-description' },
            '同一个对话在 AI 回复结束后这段时间内再发消息，不会重排侧栏；超过这段时间后的第一次发送才算新的一段工作。0 表示每次发送都算。',
          ),
          cooldownError === ''
            ? null
            : React.createElement('div', { className: 'dsh-workspace-plus-cooldown-error' }, cooldownError),
        ),
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-control' },
          React.createElement('input', {
            type: 'number',
            min: 0,
            max: 1440,
            step: 1,
            className: 'dsh-workspace-plus-number',
            'aria-label': '排序冷却（分钟）',
            value: cooldownDraft,
            disabled: state.busy || unavailable || sortEnabled === false,
            onChange: (event) => setCooldownDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void commitCooldown(cooldownDraft)
            },
          }),
          React.createElement('span', { className: 'dsh-workspace-plus-settings-unit' }, '分钟'),
          React.createElement(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              disabled: state.busy || unavailable || sortEnabled === false,
              onClick: () => void commitCooldown(cooldownDraft),
            },
            '保存',
          ),
        ),
      )

      /**
       * A workspace can only be switched from the key the host published for it.
       * Guessing one from the path is not an option: the host folds case on
       * Windows, so a guessed key would be accepted, stored, and then never match
       * — a silent no-op. A payload without keys means a stale host half, which
       * the page reports instead.
       */
      /**
       * Flip the folded-workspace list switch. It is global — one sidebar, one
       * setting — so it writes a plain setting and reads it back through the
       * shared snapshot, exactly like the sort switch above.
       *
       * @param next - the requested state.
       */
      const toggleActive = async (next) => {
        patch({ busy: true })
        try {
          const result = await postOperation({
            op: 'settings',
            settings: { [SHOW_ACTIVE_SETTING]: next },
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

      const activeEnabled = host.settings[SHOW_ACTIVE_SETTING] !== false
      const activeRow = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-settings-row' },
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-settings-text' },
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-title' },
            '折叠工作区仍显示正在工作的会话',
          ),
          React.createElement(
            'div',
            { className: 'dsh-workspace-plus-settings-description' },
            '把侧栏的工作区文件夹收起后，里面正在运行、等待批准/回答、或已完成但还没看的对话，仍会以原生的会话行显示在文件夹下面（hover 菜单、选中高亮都在）；空闲对话保持收起。关掉之后文件夹收起就只剩一行标题。',
          ),
        ),
        React.createElement(Switch, {
          checked: activeEnabled,
          disabled: state.busy || unavailable,
          label: '折叠工作区仍显示正在工作的会话',
          onChange: (next) => void toggleActive(next),
        }),
      )
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
        sortRow,
        cooldownRow,
        activeRow,
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
    /**
     * Mount one product icon into a plain DOM host.
     *
     * The row button is injected into a shell-owned row, so it has no React tree
     * of its own; the icon still comes from the product's component instead of an
     * inline copy of its artwork.
     *
     * @param host - the element to render into.
     * @param icon - the product icon component.
     * @param size - icon size in pixels.
     */
    function mountIcon(host, icon, size = 16) {
      if (host === null || host === undefined || typeof icon !== 'function') return
      if (typeof ReactDOM?.createRoot !== 'function') return
      try {
        const root = ReactDOM.createRoot(host)
        root.render(React.createElement(icon, { size }))
        mountedGlyphs.set(host, root)
      } catch {
        // A host React refuses simply keeps no icon.
      }
    }

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
          // The glyph is the product's folder icon, rendered by React rather than
          // written as markup: the button then carries the same component the
          // shell uses on the row, not a copy of its path data.
          mountIcon(button, IconFolderOpen)
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
    // 删除工作区：拦截确认，先问是否归档对话
    //
    // A Workspace's Sessions are accounted by their stored cwd: deleting the
    // registration leaves every one of them unaccounted, which is exactly what
    // the sidebar then shows under “未分组”. The product's delete dialog has no
    // extension point (the row menu and its dialogs live inside ui-workspace),
    // so this seat adds the missing question by intercepting the ONE gesture
    // that commits the delete:
    //
    //   capture-click on the dialog's confirm button
    //        → the click is stopped before React's delegated listener sees it
    //        → this plugin's own dialog asks whether to archive the Sessions
    //        → the original click is REPLAYED, so the shell still owns the
    //          delete itself, including its pending state and its closing rules
    //
    // Identification is structural rather than textual. The shell's Modal
    // renders
    //
    //   <div role="dialog" aria-modal="true" aria-label={title}>
    //     … <p class=description>…{name}…</p> … <div class=footer>
    //        <button>{cancel}</button><button>{title}</button>
    //
    // with the title repeated verbatim as the confirming button's label, and the
    // Workspace's display title quoted inside the description. Both facts are
    // locale-independent (when `ctx.locale` exists the title is also compared
    // against the shell's own `delete.workspace` string), and a dialog that does
    // not satisfy them is left completely alone — the interceptor never guesses.
    // -----------------------------------------------------------------------

    /** `shell.overlay` entry id and order of the archive-on-delete dialog. */
    const ARCHIVE_DELETE_OVERLAY_ID = 'archive-on-delete'
    const ARCHIVE_DELETE_OVERLAY_ORDER = 40

    /** How long the destructive confirm must be held before it fires. */
    const ARCHIVE_DELETE_HOLD_MS = 1200

    /** The shell's Modal always portals this shape to `document.body`. */
    const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]'

    /**
     * Services the interceptor reads lazily: the Workspace projection (which
     * Sessions belong to the Workspace being deleted, and which are already
     * archived) and the shell's dictionary (the dialog's localized title). Both
     * are optional — without them the interceptor matches nothing and the
     * shell's own confirmation behaves exactly as before.
     */
    let archiveWorkspaces = null
    let archiveLocale = null

    /** The pending archive question, or null while the dialog is closed. */
    let archiveDeleteRequest = null
    const archiveDeleteListeners = new Set()

    /**
     * The shell confirm button whose click was intercepted, plus the Workspace
     * it belongs to. Replaying that very button (rather than calling the delete
     * command) is what keeps the shell's dialog, its pending state and its
     * closing rules in charge.
     */
    let archiveDeleteReplay = null

    /** Clicks dispatched by `replayDelete()` itself; every interceptor lets them through. */
    let archiveReplayInFlight = false

    /** @returns the pending archive question (referentially stable until it changes). */
    function readArchiveDeleteRequest() {
      return archiveDeleteRequest
    }

    /**
     * Subscribe to archive-question changes.
     *
     * @param listener - called after each change.
     * @returns the unsubscribe function.
     */
    function subscribeArchiveDeleteRequest(listener) {
      archiveDeleteListeners.add(listener)
      return () => {
        archiveDeleteListeners.delete(listener)
      }
    }

    /**
     * Replace the pending archive question and notify subscribers.
     *
     * @param next - the next request, or null to close the dialog.
     */
    function writeArchiveDeleteRequest(next) {
      const previous = archiveDeleteRequest
      if (previous === next) return
      archiveDeleteRequest = next
      for (const listener of [...archiveDeleteListeners]) listener()
    }

    /** Merge one progress/error change into the pending request. */
    function patchArchiveDeleteRequest(changes) {
      const current = archiveDeleteRequest
      if (current === null) return
      writeArchiveDeleteRequest({ ...current, ...changes })
    }

    /**
     * Read the Host's Workspace projection, tolerating a composition without
     * the controller.
     *
     * @returns the snapshot, or null when the service is absent or unusable.
     */
    function readWorkspaceSnapshot() {
      const service = archiveWorkspaces
      if (service === null || service === undefined) return null
      try {
        const snapshot = service.list.getSnapshot()
        if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) return null
        return snapshot
      } catch {
        return null
      }
    }

    /**
     * Translate one shell dictionary key through the `workspace` namespace (the
     * namespace ui-workspace registers and the shell's common vocabulary backs).
     *
     * @param key - dictionary key.
     * @returns the active-language string, or '' when the service or key is absent.
     */
    function shellWorkspaceText(key) {
      const locale = archiveLocale
      if (locale === null || locale === undefined || typeof locale.bind !== 'function') return ''
      try {
        const translate = locale.bind('workspace')
        if (typeof translate !== 'function') return ''
        const value = translate(key)
        return typeof value === 'string' && value !== key ? value : ''
      } catch {
        return ''
      }
    }

    /**
     * The label one Workspace row carries: its stored title, except the
     * automatic first-use title, which the shell displays localized.
     *
     * @param workspace - one `WorkspaceView`.
     * @returns the display title, or '' when the row has none.
     */
    function archiveWorkspaceTitle(workspace) {
      if (workspace === null || typeof workspace !== 'object') return ''
      const title = typeof workspace.title === 'string' ? workspace.title : ''
      if (title === 'default-workspace') {
        const localized = shellWorkspaceText('workspace.defaultName')
        return localized === '' ? title : localized
      }
      return title
    }

    /** Escape one literal string for a RegExp. */
    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /**
     * Whether a title appears quoted inside a sentence. Every shipped
     * `delete.desc` wraps the Workspace name in one of these quote pairs
     * (“”, "…", «», „“, 「」), so the test stays version- and language-proof.
     *
     * @param text - the dialog's text.
     * @param name - the Workspace display title.
     * @returns whether the quoted title is present.
     */
    function quotedIncludes(text, name) {
      if (text === '' || name === '') return false
      const quoted = new RegExp('[“"«„「‘\']\\s*' + escapeRegExp(name) + '\\s*[”"»“」’\']')
      return quoted.test(text)
    }

    /**
     * Find the Workspace whose display title the dialog names.
     *
     * @param text - the dialog's text.
     * @param items - the Host's Workspace rows.
     * @returns `{ item, title }` of the best match, or null.
     */
    function matchWorkspaceByTitle(text, items) {
      if (text === '' || !Array.isArray(items)) return null
      const quoted = []
      const plain = []
      for (const item of items) {
        const title = archiveWorkspaceTitle(item)
        if (title === '') continue
        if (quotedIncludes(text, title)) quoted.push({ item, title })
        else if (text.includes(title)) plain.push({ item, title })
      }
      // Quoted matches are the real signal; an unquoted one is accepted only
      // when exactly one Workspace row can explain the sentence.
      const pool = quoted.length > 0 ? quoted : plain.length === 1 ? plain : []
      if (pool.length === 0) return null
      pool.sort((left, right) => right.title.length - left.title.length)
      return pool[0]
    }

    /** Whether one DOM node contains another (null-tolerant). */
    function containsNode(node, target) {
      if (node === target) return true
      if (node === null || node === undefined || typeof node.contains !== 'function') return false
      try {
        return node.contains(target)
      } catch {
        return false
      }
    }

    /** The buttons inside one footer, tolerating a fake or older DOM. */
    function readDialogButtons(footer) {
      if (footer === null || footer === undefined || typeof footer.querySelectorAll !== 'function') return []
      try {
        const found = footer.querySelectorAll('button')
        return found === null || typeof found.length !== 'number' ? [] : [...found]
      } catch {
        return []
      }
    }

    /**
     * Match one open dialog against the shell's Workspace-delete confirmation.
     *
     * @param dialog - one `[role="dialog"][aria-modal="true"]` element.
     * @param snapshot - the Host Workspace projection.
     * @returns `{ dialog, confirm, cancel, workspace, title }`, or null.
     */
    function matchWorkspaceDeleteDialog(dialog, snapshot) {
      if (dialog === null || dialog === undefined || typeof dialog.getAttribute !== 'function') return null
      const title = String(dialog.getAttribute('aria-label') ?? '').trim()
      if (title === '') return null
      // The footer is the dialog's last element child; its last button is the
      // confirming one, and the shell labels it with the dialog's title. The
      // first one is the way out.
      const buttons = readDialogButtons(dialog.lastElementChild)
      if (buttons.length < 2) return null
      const confirm = buttons[buttons.length - 1]
      if (String(confirm.textContent ?? '').trim() !== title) return null
      const localized = shellWorkspaceText('delete.workspace')
      if (localized !== '' && title !== localized) return null
      const workspace = matchWorkspaceByTitle(String(dialog.textContent ?? ''), snapshot.items)
      if (workspace === null) return null
      // The way out: prefer the shell's own `cancel` label so an added footer
      // button cannot shift the position, and fall back to the first button on a
      // shell whose dictionary is unavailable.
      const cancelLabel = shellWorkspaceText('cancel')
      const cancel = (cancelLabel === ''
        ? buttons[0]
        : buttons.find((button) => String(button.textContent ?? '').trim() === cancelLabel)) ?? buttons[0] ?? null
      return { dialog, confirm, cancel, workspace: workspace.item, title: workspace.title }
    }

    /**
     * Find the top-most open Workspace-delete confirmation.
     *
     * @param doc - the document to search.
     * @returns the match, or null.
     */
    function findWorkspaceDeleteDialog(doc) {
      if (doc === null || doc === undefined || typeof doc.querySelectorAll !== 'function') return null
      const snapshot = readWorkspaceSnapshot()
      if (snapshot === null) return null
      let dialogs
      try {
        dialogs = doc.querySelectorAll(DIALOG_SELECTOR)
      } catch {
        return null
      }
      if (dialogs === null || typeof dialogs.length !== 'number') return null
      for (let index = dialogs.length - 1; index >= 0; index -= 1) {
        const found = matchWorkspaceDeleteDialog(dialogs[index], snapshot)
        if (found !== null) return found
      }
      return null
    }

    /**
     * Replay the intercepted confirm click. The shell's own handler then runs the
     * delete exactly as it would have, so its pending state and closing rules
     * stay authoritative. A button that left the DOM (the dialog was closed from
     * under us) falls back to the delete command, so the Workspace still goes.
     */
    function replayDelete() {
      const pending = archiveDeleteReplay
      archiveDeleteReplay = null
      if (pending === null) return
      const button = pending.button
      if (button !== null && button !== undefined && button.isConnected !== false && typeof button.click === 'function') {
        // `click()` dispatches synchronously, so a plain flag is enough to let
        // every installed interceptor pass this one replayed event through.
        archiveReplayInFlight = true
        try {
          button.click()
        } finally {
          archiveReplayInFlight = false
        }
        return
      }
      const service = archiveWorkspaces
      if (service !== null && service !== undefined && typeof service.delete === 'function') {
        Promise.resolve(service.delete(pending.workspaceId)).catch(() => {})
      }
    }

    /**
     * Replay the shell dialog's cancel affordance, closing the confirmation the
     * question was asked about. Nothing is replayed when that button already
     * left the DOM.
     */
    function replayCancel() {
      const pending = archiveDeleteReplay
      archiveDeleteReplay = null
      if (pending === null) return
      const cancel = pending.cancel
      if (cancel === null || cancel === undefined || cancel.isConnected === false || typeof cancel.click !== 'function') return
      archiveReplayInFlight = true
      try {
        cancel.click()
      } finally {
        archiveReplayInFlight = false
      }
    }

    /** Whether an archive refusal is the running-work one (`workspace/session-active`). */
    function isActiveSessionRefusal(error) {
      const code = error !== null && error !== undefined && error.rpcError !== null && typeof error.rpcError === 'object'
        ? error.rpcError.code
        : undefined
      return code === 'workspace/session-active'
    }

    /** Whether an archive refusal means the Session no longer exists. */
    function isUnknownSessionRefusal(error) {
      const code = error !== null && error !== undefined && error.rpcError !== null && typeof error.rpcError === 'object'
        ? error.rpcError.code
        : undefined
      return code === 'session/not-found'
    }

    /** One-line description of a failed Host call. */
    function describeArchiveError(error) {
      if (error !== null && error !== undefined && typeof error === 'object') {
        if (error.rpcError !== null && typeof error.rpcError === 'object' && typeof error.rpcError.message === 'string' && error.rpcError.message !== '') {
          return error.rpcError.message
        }
        if (typeof error.message === 'string' && error.message !== '') return error.message
      }
      return String(error)
    }

    /**
     * Archive every Session the pending question lists, then replay the delete.
     * Sessions with running work are archived with `stopActivity` — the long
     * press is the confirmation for that (the dialog says so before it is
     * pressed), and anything that still fails keeps the Workspace in place and
     * reports why, so a partial archive never silently deletes it.
     */
    async function archiveWorkspaceSessions() {
      const request = archiveDeleteRequest
      if (request === null) return
      const service = archiveWorkspaces
      if (service === null || service === undefined || typeof service.archiveSession !== 'function') {
        patchArchiveDeleteRequest({
          phase: 'error',
          error: '当前页面没有加载 workspace 服务，无法归档。请刷新页面后重试，或选择「仅删除工作区」。',
        })
        return
      }
      patchArchiveDeleteRequest({ phase: 'archiving', done: 0, error: '' })
      let done = 0
      for (const sessionId of request.sessionIds) {
        try {
          await service.archiveSession(sessionId)
        } catch (error) {
          if (isActiveSessionRefusal(error)) {
            try {
              await service.archiveSession(sessionId, { stopActivity: true })
            } catch (retryError) {
              patchArchiveDeleteRequest({ phase: 'error', error: '归档失败：' + describeArchiveError(retryError) })
              return
            }
          } else if (!isUnknownSessionRefusal(error)) {
            patchArchiveDeleteRequest({ phase: 'error', error: '归档失败：' + describeArchiveError(error) })
            return
          }
        }
        done += 1
        patchArchiveDeleteRequest({ done })
      }
      writeArchiveDeleteRequest(null)
      replayDelete()
    }

    /**
     * Dismiss the question. The cancel affordance of the shell's own dialog is
     * replayed too, so cancelling the archive question leaves the sidebar rather
     * than a delete confirmation the user has already answered.
     */
    function cancelArchiveDelete() {
      writeArchiveDeleteRequest(null)
      replayCancel()
    }

    /** Skip archiving and let the shell's own confirmation proceed. */
    function skipArchiveAndDelete() {
      if (archiveDeleteRequest === null) return
      writeArchiveDeleteRequest(null)
      replayDelete()
    }

    /**
     * Install the interception of the shell's Workspace-delete confirmation.
     *
     * A capture listener on `document` runs before React's delegated handlers,
     * so stopping the event here keeps the shell's confirm handler from ever
     * seeing the click; everything the plugin does is decided in that one
     * gesture, and a dialog it cannot prove is the Workspace-delete one is left
     * untouched.
     *
     * @param doc - the page document.
     * @returns `{ installed, dispose }`.
     */
    function installArchiveOnDelete(doc) {
      if (doc === null || doc === undefined || typeof doc.addEventListener !== 'function') {
        return { installed: false, dispose() {} }
      }
      const onClick = (event) => {
        if (archiveReplayInFlight) return
        if (archiveDeleteRequest !== null) return
        const target = event === null || event === undefined ? null : event.target
        if (target === null || target === undefined) return
        // Cheap rejection first: the confirming button lives inside a dialog, so
        // a click anywhere else cannot be it. (The full scan stays the fallback
        // for a DOM double that does not implement closest().)
        if (typeof target.closest === 'function' && target.closest(DIALOG_SELECTOR) === null) return
        const found = findWorkspaceDeleteDialog(doc)
        if (found === null) return
        if (!containsNode(found.dialog, target)) return
        if (target !== found.confirm && !containsNode(found.confirm, target)) return
        const snapshot = readWorkspaceSnapshot()
        if (snapshot === null) return
        const archived = new Set(Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : [])
        const sessionIds = (Array.isArray(found.workspace.sessionIds) ? found.workspace.sessionIds : [])
          .filter((sessionId) => !archived.has(sessionId))
        // Nothing to ask about: the shell's plain delete is the right answer.
        if (sessionIds.length === 0) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        archiveDeleteReplay = {
          button: found.confirm,
          // The dialog's cancel affordance, so dismissing the question can also
          // dismiss the shell's confirmation instead of dropping the user back
          // onto a dialog they already answered.
          cancel: found.cancel,
          workspaceId: found.workspace.workspaceId,
        }
        writeArchiveDeleteRequest({
          workspaceId: found.workspace.workspaceId,
          displayTitle: found.title,
          sessionIds,
          total: sessionIds.length,
          done: 0,
          phase: 'idle',
          error: '',
        })
      }
      doc.addEventListener('click', onClick, true)
      return {
        installed: true,
        dispose() {
          if (typeof doc.removeEventListener === 'function') doc.removeEventListener('click', onClick, true)
          archiveDeleteReplay = null
          writeArchiveDeleteRequest(null)
        },
      }
    }

    /**
     * The archive question itself, registered into `shell.overlay`. It opens on
     * the request the interceptor captured, lists what will happen, and gates
     * the destructive answer behind a long press so a single stray click cannot
     * archive a Workspace's whole conversation history.
     *
     * The props seam exists only for tests; the shell renders overlay entries
     * with its own standard props.
     *
     * @param props - optional request/initial state for tests.
     * @returns the modal, or null while no question is pending.
     */
    function ArchiveDeleteDialog(props) {
      const request = React.useSyncExternalStore(subscribeArchiveDeleteRequest, readArchiveDeleteRequest)
      const [holdProgress, setHoldProgress] = React.useState(0)
      const [holding, setHolding] = React.useState(false)
      const hold = React.useRef({ frame: null, startedAt: null, completed: false })
      const requestKey = request === null ? '' : String(request.workspaceId) + ':' + String(request.total)
      const requestPhase = request === null ? '' : String(request.phase)

      // A new question starts from a clean hold, even if the previous one was
      // released in the middle of its animation.
      React.useEffect(() => {
        setHoldProgress(0)
        setHolding(false)
        const state = hold.current
        state.frame = null
        state.startedAt = null
        state.completed = false
        return undefined
      }, [requestKey])

      // A failed archive re-enables the button; drop the completed press's fill
      // so it reads as ready to be held again instead of as still in progress.
      React.useEffect(() => {
        if (requestPhase !== 'error') return undefined
        setHoldProgress(0)
        setHolding(false)
        const state = hold.current
        state.completed = false
        return undefined
      }, [requestPhase])

      if (request === null) return null

      /** Stop the hold animation without completing the press. */
      const stopHold = () => {
        const state = hold.current
        // A press that already completed is past cancelling: the release that
        // follows it must not clear the fill the archive is running under.
        if (state.completed) return
        if (state.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame)
        state.frame = null
        state.startedAt = null
        setHolding(false)
        setHoldProgress(0)
      }

      /** Complete the hold: archive everything, then replay the delete. */
      const finishHold = () => {
        const state = hold.current
        if (state.completed) return
        state.completed = true
        state.frame = null
        state.startedAt = null
        setHolding(false)
        setHoldProgress(1)
        void archiveWorkspaceSessions()
      }

      /** One animation frame of the hold; the first frame anchors the clock. */
      const stepHold = (timestamp) => {
        const state = hold.current
        const at = typeof timestamp === 'number' ? timestamp : 0
        if (state.startedAt === null) state.startedAt = at
        const elapsed = at - state.startedAt
        if (elapsed >= ARCHIVE_DELETE_HOLD_MS) {
          finishHold()
          return
        }
        setHoldProgress(elapsed / ARCHIVE_DELETE_HOLD_MS)
        if (typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(stepHold)
        else state.frame = null
      }

      /** Start holding; a second press while one is in flight is ignored. */
      const beginHold = () => {
        if (request.phase === 'archiving') return
        const state = hold.current
        if (state.frame !== null) return
        state.startedAt = null
        state.completed = false
        setHolding(true)
        setHoldProgress(0)
        if (typeof requestAnimationFrame === 'function') state.frame = requestAnimationFrame(stepHold)
      }

      const archiving = request.phase === 'archiving'
      const holdLabel = holding
        ? '继续按住…'
        : archiving
          ? '正在归档…'
          : '长按归档并删除'

      const holdButton = React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-workspace-plus-hold',
          'data-holding': holding ? 'true' : 'false',
          disabled: archiving,
          'aria-label': '按住以归档该工作区的全部对话，然后删除工作区；松开即取消',
          title: '按住约 ' + String(ARCHIVE_DELETE_HOLD_MS / 1000) + ' 秒确认：归档对话并删除工作区',
          onPointerDown: () => beginHold(),
          onPointerUp: () => stopHold(),
          onPointerLeave: () => stopHold(),
          onPointerCancel: () => stopHold(),
          onKeyDown: (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            if (typeof event.preventDefault === 'function') event.preventDefault()
            beginHold()
          },
          onKeyUp: (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            stopHold()
          },
        },
        React.createElement('span', {
          className: 'dsh-workspace-plus-hold-fill',
          style: { width: String(Math.round(holdProgress * 100)) + '%' },
          'aria-hidden': 'true',
        }),
        React.createElement('span', { className: 'dsh-workspace-plus-hold-label' }, holdLabel),
      )

      const footer = React.createElement(
        'div',
        { className: 'dsh-workspace-plus-footer' },
        React.createElement(Button, { variant: 'ghost', disabled: archiving, onClick: () => cancelArchiveDelete() }, '取消'),
        React.createElement(Button, { variant: 'outline', disabled: archiving, onClick: () => skipArchiveAndDelete() }, '仅删除工作区'),
        holdButton,
      )

      const body = [
        React.createElement(
          'div',
          { className: 'dsh-workspace-plus-archive-note' },
          '归档只会把对话从侧栏隐藏，之后可在「全部对话（显示已归档）」里恢复；正在运行的对话会先停止。',
        ),
        React.createElement('div', { className: 'dsh-workspace-plus-archive-note' }, '按住下面的按钮不放，约 ' + String(ARCHIVE_DELETE_HOLD_MS / 1000) + ' 秒后自动完成归档并删除。'),
        archiving
          ? React.createElement(
              'div',
              { className: 'dsh-workspace-plus-archive-progress', role: 'status' },
              '正在归档 ' + String(request.done) + ' / ' + String(request.total) + '…',
            )
          : null,
        request.error === ''
          ? null
          : React.createElement('div', { className: 'dsh-workspace-plus-archive-error', role: 'alert' }, request.error),
      ].filter((node) => node !== null)

      return React.createElement(
        Modal,
        {
          open: true,
          onClose: () => {
            if (archiving) return
            cancelArchiveDelete()
          },
          closeLabel: '关闭',
          title: '删除工作区前，归档对话？',
          description: '“' + request.displayTitle + '”有 ' + String(request.total) + ' 个对话。删除工作区后，它们会移到「未分组」下。',
          className: 'dsh-workspace-plus-dialog-card',
          footer,
        },
        React.createElement('div', { className: 'dsh-workspace-plus-archive-delete' }, ...body),
      )
    }

    // -----------------------------------------------------------------------
    // The row configuration pages (plugin detail page, not Settings)
    //
    // Both settings surfaces used to be `settings.section` pages in the product's
    // Settings navigation. They now occupy `plugins.row.config`, one entry per
    // loader row: the bundle's detail page lists its rows, each row carries a
    // configure control, and that control opens the page below. Nothing is
    // registered into `settings.section` any more.
    //
    // The page owner hands an entry `{ view, form }`. These pages write through
    // the Host routes the moment a switch flips (the Host answers with a fresh
    // snapshot), so they ignore `form` — the same "immediate write, no draft"
    // contract they had on the Settings page. `view: 'summary'` renders the
    // row's one-liner, which the row also falls back to when the patch declares
    // no description of its own.
    // -----------------------------------------------------------------------

    /** One-liner of the `workspaceplus` row (also its description fallback). */
    const WORKSPACE_ROW_SUMMARY =
      '按工作区开关标签表与 workspace_dirs 工具，让侧栏工作区按最近对话排序，并让折叠的文件夹仍显示正在工作的会话。'

    /** One-liner of the `notice` row (also its description fallback). */
    const NOTICE_ROW_SUMMARY = 'Windows 桌面通知：权限请求、提问、完成、中断与出错；点击通知打开对应对话。'

    /**
     * The `workspaceplus` row's configuration page.
     *
     * @param props - the page owner's `{ view, form }`.
     * @returns the row's one-liner, or the `workspace+` settings page.
     */
    function WorkspaceRowConfig(props) {
      if (props !== null && typeof props === 'object' && props.view === 'summary') return WORKSPACE_ROW_SUMMARY
      return React.createElement(WorkspacePlusSettings, null)
    }

    /**
     * The `notice` row's configuration page.
     *
     * @param props - the page owner's `{ view, form }`.
     * @returns the row's one-liner, or the 通知 settings page.
     */
    function NoticeRowConfig(props) {
      if (props !== null && typeof props === 'object' && props.view === 'summary') return NOTICE_ROW_SUMMARY
      return React.createElement(NoticeSettings, null)
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
     * Contribute the two row settings pages (`workspaceplus`, `notice`) on the
     * plugin detail page, the directory dialog, its fallback entry, and the
     * workspace-row buttons that open it — plus the 通知 client faces (its row
     * settings page and the pending-open poll behind notification clicks).
     *
     * Every registration goes through `ctx.slots.inject(key, callback)`: the
     * callback runs as soon as the shell declares that slot (immediately when it
     * already exists), and its returned disposer is owned by this plugin's fiber,
     * so unloading the plugin removes the entry again.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      // The `workspace+` settings page, contributed as the `workspaceplus` row's
      // configuration page on the plugin detail page. The slot is keyed by
      // `<package name>#<row id>`, so it follows the bundle patch rather than a
      // Settings-section label; the page owns the per-workspace switches and the
      // sidebar-sort switch.
      ctx.effect(
        () =>
          ctx.slots.inject(ROW_CONFIG_SLOT, () =>
            ctx.slots.register({ name: ROW_CONFIG_SLOT, key: WORKSPACE_ROW_CONFIG_KEY }, WorkspaceRowConfig),
          ),
        'dsh-workspace-plus: workspace+ row settings',
      )

      // The 通知 sub-feature. Both faces are guarded by `registerNotice`: a
      // failure is reported and skipped instead of failing the fiber, because
      // the shell's boot audit treats every non-ACTIVE entry as fatal and the
      // workspace+ features must survive a notice-side mistake. The poll runs
      // unconditionally — clicking an older notification must still open the
      // conversation even while the notice ROW is off (its host half answers
      // 404, the poll backs off quietly). The settings page is the `notice`
      // row's configuration page on the plugin detail page — the same seat the
      // workspace+ page takes, keyed by this row's own id.
      registerNotice(ctx, '通知轮询', () => ctx.effect(() => startNoticePendingPoll(ctx), 'dsh-workspace-plus/notice: pending open poll'))
      registerNotice(ctx, '通知设置页', () =>
        ctx.effect(
          () =>
            ctx.slots.inject(ROW_CONFIG_SLOT, () =>
              ctx.slots.register({ name: ROW_CONFIG_SLOT, key: NOTICE_ROW_CONFIG_KEY }, NoticeRowConfig),
            ),
          'dsh-workspace-plus/notice: row settings',
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

      // Sidebar Workspace ordering. Both services are optional: without the
      // Session projection or the Workspace controller the ordering simply
      // never runs, and every other seat of this plugin is unaffected.
      ctx.effect(
        () =>
          ctx.inject(['sessions', 'workspaces'], (orderScope) => {
            const ordering = installWorkspaceOrdering({
              workspaces: orderScope.workspaces,
              sessions: orderScope.sessions,
            })
            return () => {
              ordering.dispose()
            }
          }),
        'dsh-workspace-plus: workspace order by recency',
      )

      // The folded-workspace list: keep the working conversations of a folded
      // group visible. Both services and the status source are optional by
      // contract; without them the seat draws nothing and every other face of
      // the plugin is unaffected.
      ctx.effect(
        () =>
          ctx.inject(['sessions', 'workspaces'], (activeScope) => {
            const foldedActive = installCollapsedActiveSessions({
              sessions: activeScope.sessions,
              workspaces: activeScope.workspaces,
              uiSession: () => {
                try {
                  return ctx.get('uiSession') ?? null
                } catch {
                  return null
                }
              },
            })
            return () => {
              foldedActive.dispose()
            }
          }),
        'dsh-workspace-plus: working conversations in folded workspaces',
      )

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
      // the settings: a switch flipped in the row settings page re-marks its button
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

      // The delete-workspace interception. The Workspace projection decides
      // which Sessions the Workspace owns, and the shell dictionary names the
      // dialog title; both are injected optionally, and without them the
      // interceptor simply matches nothing and the shell's own confirmation is
      // left exactly as it was.
      ctx.effect(
        () =>
          ctx.inject(['workspaces'], (workspaceScope) => {
            archiveWorkspaces = workspaceScope.workspaces
            return () => {
              archiveWorkspaces = null
            }
          }),
        'dsh-workspace-plus: workspace projection for archive-on-delete',
      )

      ctx.effect(
        () =>
          ctx.inject(['locale'], (localeScope) => {
            archiveLocale = localeScope.locale
            return () => {
              archiveLocale = null
            }
          }),
        'dsh-workspace-plus: dictionary for the delete dialog title',
      )

      ctx.effect(
        () => {
          const interceptor = installArchiveOnDelete(typeof document === 'undefined' ? null : document)
          return () => interceptor.dispose()
        },
        'dsh-workspace-plus: archive-on-delete interceptor',
      )

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: ARCHIVE_DELETE_OVERLAY_ID, order: ARCHIVE_DELETE_OVERLAY_ORDER },
              ArchiveDeleteDialog,
            ),
          ),
        'dsh-workspace-plus: archive-on-delete dialog',
      )
    }

    exports.WORKDIRS_PANEL_ID = WORKDIRS_PANEL_ID
    exports.WORKDIRS_PANEL_LABEL = WORKDIRS_PANEL_LABEL
    exports.PACKAGE_NAME = PACKAGE_NAME
    exports.ROW_CONFIG_SLOT = ROW_CONFIG_SLOT
    exports.WORKSPACE_ROW_ID = WORKSPACE_ROW_ID
    exports.NOTICE_ROW_ID = NOTICE_ROW_ID
    exports.WORKSPACE_ROW_CONFIG_KEY = WORKSPACE_ROW_CONFIG_KEY
    exports.NOTICE_ROW_CONFIG_KEY = NOTICE_ROW_CONFIG_KEY
    exports.WORKSPACE_ROW_SUMMARY = WORKSPACE_ROW_SUMMARY
    exports.NOTICE_ROW_SUMMARY = NOTICE_ROW_SUMMARY
    exports.WorkspaceRowConfig = WorkspaceRowConfig
    exports.NoticeRowConfig = NoticeRowConfig
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
    exports.SORT_WORKSPACES_SETTING = SORT_WORKSPACES_SETTING
    exports.SHOW_ACTIVE_SETTING = SHOW_ACTIVE_SETTING
    exports.isActiveSessionsShown = isActiveSessionsShown
    exports.isPathInside = isPathInside
    exports.activeSessionIds = activeSessionIds
    exports.workspaceSubtreeSessionIds = workspaceSubtreeSessionIds
    exports.FOLDED_SECTION_CLASS = FOLDED_SECTION_CLASS
    exports.FOLDED_STORAGE_KEY = FOLDED_STORAGE_KEY
    exports.installCollapsedActiveSessions = installCollapsedActiveSessions
    exports.WORKSPACE_SORT_DEBOUNCE_MS = WORKSPACE_SORT_DEBOUNCE_MS
    exports.isWorkspaceSortEnabled = isWorkspaceSortEnabled
    exports.newestSessionTime = newestSessionTime
    exports.orderWorkspacesByRecency = orderWorkspacesByRecency
    exports.workspaceMoves = workspaceMoves
    exports.installWorkspaceOrdering = installWorkspaceOrdering
    exports.SORT_COOLDOWN_SETTING = SORT_COOLDOWN_SETTING
    exports.SORT_COOLDOWN_DEFAULT_MINUTES = SORT_COOLDOWN_DEFAULT_MINUTES
    exports.readCooldownMinutes = readCooldownMinutes
    exports.sortCooldownMs = sortCooldownMs
    exports.rememberSessions = rememberSessions
    exports.sessionTransitions = sessionTransitions
    exports.workspaceOfSession = workspaceOfSession
    exports.folderHasRunningSession = folderHasRunningSession
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
    exports.ARCHIVE_DELETE_OVERLAY_ID = ARCHIVE_DELETE_OVERLAY_ID
    exports.ARCHIVE_DELETE_OVERLAY_ORDER = ARCHIVE_DELETE_OVERLAY_ORDER
    exports.ARCHIVE_DELETE_HOLD_MS = ARCHIVE_DELETE_HOLD_MS
    exports.DIALOG_SELECTOR = DIALOG_SELECTOR
    exports.readArchiveDeleteRequest = readArchiveDeleteRequest
    exports.subscribeArchiveDeleteRequest = subscribeArchiveDeleteRequest
    exports.archiveWorkspaceTitle = archiveWorkspaceTitle
    exports.matchWorkspaceByTitle = matchWorkspaceByTitle
    exports.quotedIncludes = quotedIncludes
    exports.matchWorkspaceDeleteDialog = matchWorkspaceDeleteDialog
    exports.findWorkspaceDeleteDialog = findWorkspaceDeleteDialog
    exports.installArchiveOnDelete = installArchiveOnDelete
    exports.archiveWorkspaceSessions = archiveWorkspaceSessions
    exports.cancelArchiveDelete = cancelArchiveDelete
    exports.skipArchiveAndDelete = skipArchiveAndDelete
    exports.ArchiveDeleteDialog = ArchiveDeleteDialog
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
