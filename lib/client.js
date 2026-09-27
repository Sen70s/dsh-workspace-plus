/**
 * dsh-workspaceplus — browser half.
 *
 * This file is the package's `./client` export: a self-contained, factory-form
 * CommonJS bundle registered with the shell's client module loader. The host
 * serves it at `/plugins/dsh-workspaceplus/client.js`; the browser loads the
 * script during boot but only *materializes* it (runs the factory body) when the
 * plugin is first needed, so every side effect here — the injected stylesheet
 * included — happens at materialization time, never at script-parse time.
 *
 * The feature — workspace directories, as a DIALOG rather than a page.
 * A DSH workspace keeps its one root directory; this registers N more project
 * folders against it, each with a short label, and the host injects that table
 * into the agent's context on every request — so "改 backend" in conversation
 * resolves to an absolute path instead of a guess.
 *
 * Four seats cooperate:
 *
 *   `settings.section`    the `workspace+` settings page. It owns one preference:
 *                         whether the feature runs for the default (first-use)
 *                         Workspace, which is off until the user turns it on
 *                         because that Workspace belongs to the product.
 *
 *   `shell.overlay`       the dialog itself, the same frame-wide layer the
 *                         shell's own workspace Rename/Delete dialogs use (the
 *                         Modal portals to <body>, so the entry owns only the
 *                         open state, not the stack position). Its browse control
 *                         calls the shell's own directory picker through
 *                         `ctx.uiWorkspace.pickDirectory()`.
 *
 *   workspace row button  the primary trigger. The shell's workspace row menu is
 *                         hardcoded to Rename/Delete with no plugin slot, so the
 *                         trigger is a button this half appends to the row's
 *                         action cluster, located through shell-emitted
 *                         `data-row-key="workspace:<id>"` anchors and kept in
 *                         place by a MutationObserver. Rows the host reports as
 *                         disabled get no button.
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
 * Only the shell's frozen platform module table may be `require`d here (react,
 * react-dom, react/jsx-runtime, @deepseek-ai/cordis,
 * @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots,
 * @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit).
 * Any other specifier needs a matching `dsh.client.external` entry in
 * package.json, which this plugin does not use.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspaceplus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { Button, Modal, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')

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

    /** The settings key this page owns. */
    const DEFAULT_WORKSPACE_SETTING = 'defaultWorkspaceEnabled'

    /** Host JSON endpoint, resolved against the page so it survives any mount path. */
    const API_PATH = 'workspaceplus/api'

    /** Identity of the injected stylesheet, used to keep exactly one copy. */
    const STYLE_ID = 'dsh-workspaceplus/panel.css'

    /**
     * Row anchors. The shell emits `data-slot="<slot key>"` on every slot outlet
     * and `data-row-key="workspace:<workspaceId>"` on a workspace group row, and
     * a row's last element child is its action cluster.
     */
    const SIDEBAR_SLOT_SELECTOR = '[data-slot="sidebar.workspaces"]'
    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const ROW_KEY_PREFIX = 'workspace:'

    /** Class of the button this half appends to a workspace row. */
    const ROW_BUTTON_CLASS = 'dsh-workspaceplus-rowbtn'

    /** Label of the injected row button. */
    const ROW_BUTTON_LABEL = '工作区目录设置'

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
     * How long the fallback entry waits before deciding that no workspace-row
     * button can exist, so a healthy shell never flashes it.
     */
    const FALLBACK_SETTLE_MS = 1200

    /**
     * Panel styles. Everything is namespaced under `dsh-workspaceplus-` and
     * colored through the shell's theme tokens, so the surfaces follow the active
     * light/dark theme instead of hard-coding colors. Fallbacks after each token
     * keep them readable on a shell that predates a given token.
     */
    const CSS = `
.dsh-workspaceplus-panel{box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex:1 1 auto;height:100%;min-height:0;padding:32px 24px;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dsh-workspaceplus-card{box-sizing:border-box;width:min(520px,100%);display:flex;flex-direction:column;align-items:center;gap:14px;padding:36px 32px 30px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);text-align:center;animation:dsh-workspaceplus-in .18s var(--ds-ease-in-out,ease-out) both}
.dsh-workspaceplus-badge{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-workspaceplus-glyph{display:block}
.dsh-workspaceplus-title{margin:0;font-size:24px;font-weight:600;letter-spacing:.2px}
.dsh-workspaceplus-subtitle{margin:0;max-width:42ch;color:var(--dsw-alias-label-secondary)}
.dsh-workspaceplus-actions{display:flex;align-items:center;gap:12px;margin-top:6px}
.dsh-workspaceplus-settings{flex-direction:column;width:100%;display:flex}
.dsh-workspaceplus-settings-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}
.dsh-workspaceplus-settings-text{min-width:0}
.dsh-workspaceplus-settings-title{font-size:14px;line-height:20px}
.dsh-workspaceplus-settings-description{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.dsh-workspaceplus-settings-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsh-workspaceplus-settings-ok{color:var(--dsw-alias-state-success-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsh-workspaceplus-rowbtn{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:none;flex:none;cursor:pointer;border-radius:var(--dsw-radius-xs,4px);background:0 0;color:var(--dsw-alias-label-tertiary)}
.dsh-workspaceplus-rowbtn:hover{color:var(--dsw-alias-label-primary)}
.dsh-workspaceplus-rowbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}
.dsh-workspaceplus-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}
.dsh-workspaceplus-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-workspaceplus-label{color:var(--dsw-alias-label-secondary);flex:none}
.dsh-workspaceplus-locked{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-workspaceplus-select,.dsh-workspaceplus-input{box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-md,8px);padding:6px 9px;min-width:0}
.dsh-workspaceplus-select{max-width:100%;flex:1 1 240px}
.dsh-workspaceplus-input:focus-visible,.dsh-workspaceplus-select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}
.dsh-workspaceplus-input-path{flex:1 1 260px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-workspaceplus-input-label{flex:0 1 140px}
.dsh-workspaceplus-input-note{flex:1 1 180px}
.dsh-workspaceplus-list{box-sizing:border-box;width:100%;max-height:34vh;overflow-y:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px)}
.dsh-workspaceplus-row{display:flex;align-items:center;gap:12px;padding:9px 12px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-workspaceplus-row:first-child{border-top:none}
.dsh-workspaceplus-row-tag{flex:none;min-width:76px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);font-weight:600;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-workspaceplus-row-path{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-workspaceplus-row-note{flex:0 1 auto;color:var(--dsw-alias-label-secondary);max-width:24ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-workspaceplus-row-outside{flex:none;color:var(--dsw-alias-state-warn-primary);font-size:12px}
.dsh-workspaceplus-form{display:flex;flex-direction:column;gap:8px;width:100%}
.dsh-workspaceplus-form-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%}
.dsh-workspaceplus-empty{padding:14px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.dsh-workspaceplus-note{color:var(--dsw-alias-label-secondary);font-size:13px}
.dsh-workspaceplus-error{color:var(--dsw-alias-state-error-primary)}
.dsh-workspaceplus-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-workspaceplus-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);word-break:break-all}
@keyframes dsh-workspaceplus-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-workspaceplus-card{animation:none}}
`

    /**
     * Append the panel stylesheet once per document. The factory body runs at
     * materialization, so this is a one-time boot-time side effect; the
     * `data-plugin-css` marker both deduplicates it and lets the shell's HMR
     * teardown find the tag as plugin-owned.
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspaceplus'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    ensureStyles()

    // -----------------------------------------------------------------------
    // The workspace-directory feature
    // -----------------------------------------------------------------------

    /**
     * The directory glyph, shared by the fallback sidebar entry and the hint
     * panel. It draws the same official artwork as the injected row button, so
     * every entry point to this feature looks like the shell's own icons.
     *
     * @param props - sidebar icon share, plus the optional click handler.
     * @returns the icon element.
     */
    function WorkdirsPanelIcon({ size = 16, onClick }) {
      return React.createElement(
        'svg',
        {
          className: 'dsh-workspaceplus-glyph',
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          ...(onClick === undefined ? {} : { onClick }),
        },
        FOLDER_ARTWORK.map((path, index) =>
          React.createElement('path', {
            key: index,
            d: path.d,
            fill: 'currentColor',
            ...(path.opacity === undefined ? {} : { opacity: path.opacity }),
          }),
        ),
      )
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
     * surfaces: the settings page reads the settings and the default-workspace
     * identity from it, the row installer consults the per-workspace `enabled`
     * flag, and the dialog refreshes it after every mutation.
     */
    let hostState = {
      known: false,
      settings: { [DEFAULT_WORKSPACE_SETTING]: false },
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
      hostState = {
        known: true,
        settings: { [DEFAULT_WORKSPACE_SETTING]: payload.settings?.[DEFAULT_WORKSPACE_SETTING] === true },
        defaultWorkspaceId: typeof payload.defaultWorkspaceId === 'string' ? payload.defaultWorkspaceId : null,
        defaultWorkspacePath: typeof payload.defaultWorkspacePath === 'string' ? payload.defaultWorkspacePath : null,
        workspaces: Array.isArray(payload.workspaces) ? payload.workspaces : [],
      }
      for (const listener of [...hostStateListeners]) listener()
      return true
    }

    /**
     * Whether the feature runs for one workspace id. A row whose workspace is not
     * in the snapshot yet keeps its entry point: hiding it on a guess would remove
     * the UI from a perfectly ordinary workspace.
     *
     * @param workspaceId - the id taken from the row's `data-row-key`.
     * @returns true when the row should carry the directory button.
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
     * One registered directory row.
     *
     * @param props - the row's directory, its workspace root, and the remove handler.
     * @returns the row element.
     */
    function DirectoryRow({ dir, workspacePath, onRemove, disabled }) {
      const outside = isOutside(workspacePath, dir.path)
      return React.createElement(
        'div',
        { className: 'dsh-workspaceplus-row' },
        React.createElement('span', { className: 'dsh-workspaceplus-row-tag' }, dir.label),
        React.createElement('span', { className: 'dsh-workspaceplus-row-path', title: dir.path }, dir.path),
        dir.note === undefined ? null : React.createElement('span', { className: 'dsh-workspaceplus-row-note' }, dir.note),
        outside ? React.createElement('span', { className: 'dsh-workspaceplus-row-outside' }, '工作区根目录之外') : null,
        React.createElement(
          Button,
          { variant: 'outline', size: 'sm', disabled, onClick: () => onRemove(dir.label) },
          '删除',
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

      const toolbar = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-toolbar' },
        React.createElement('span', { className: 'dsh-workspaceplus-label' }, '工作区'),
        state.locked
          ? React.createElement('span', { className: 'dsh-workspaceplus-locked' }, selected?.title || selected?.path || '')
          : React.createElement(
              'select',
              {
                className: 'dsh-workspaceplus-select',
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
        state.locked
          ? React.createElement('span', { className: 'dsh-workspaceplus-note dsh-workspaceplus-mono' }, selected?.path ?? '')
          : null,
      )

      const body = (() => {
        if (state.status === 'loading') {
          return React.createElement(
            'div',
            { className: 'dsh-workspaceplus-list' },
            React.createElement('div', { className: 'dsh-workspaceplus-empty' }, '正在读取 host…'),
          )
        }
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
                '重启后终端会出现 [dsh-workspaceplus] host half loaded 一行；若没有，请到 设置 → 插件 查看该插件行的状态。'
              : '这个面板通过 ' +
                API_PATH +
                ' 与宿主进程通信，而当前页面没有可用的 HTTP 通道（例如页面不是 dsh 提供的、或宿主进程还没起来）。'
          return React.createElement(
            'div',
            { className: 'dsh-workspaceplus-list' },
            React.createElement(
              'div',
              { className: 'dsh-workspaceplus-empty' },
              React.createElement('div', { className: 'dsh-workspaceplus-error' }, '无法连接 host 接口：' + state.message),
              React.createElement('div', { className: 'dsh-workspaceplus-note' }, diagnosis),
              React.createElement(
                'div',
                { className: 'dsh-workspaceplus-note' },
                '宿主半加载之后，映射也可以在对话里用 workspace_dirs 工具管理。',
              ),
            ),
          )
        }
        if (!state.registryAvailable) {
          return React.createElement(
            'div',
            { className: 'dsh-workspaceplus-list' },
            React.createElement(
              'div',
              { className: 'dsh-workspaceplus-empty' },
              '宿主进程没有加载 workspace 注册表，无法列出工作区。请在对话里用 workspace_dirs 工具按绝对路径管理标签。',
            ),
          )
        }
        if (selected === null) {
          return React.createElement(
            'div',
            { className: 'dsh-workspaceplus-list' },
            React.createElement('div', { className: 'dsh-workspaceplus-empty' }, '还没有任何工作区。先在左侧边栏新建一个工作区，再回到这里登记目录。'),
          )
        }
        return React.createElement(
          'div',
          { className: 'dsh-workspaceplus-list' },
          dirs.length === 0
            ? React.createElement('div', { className: 'dsh-workspaceplus-empty' }, '这个工作区还没有登记额外目录。用下面的表单添加第一个标签。')
            : dirs.map((dir) =>
                React.createElement(DirectoryRow, {
                  key: dir.label,
                  dir,
                  workspacePath: selected.path,
                  disabled: state.busy,
                  onRemove: (label) => void removeDirectory(label),
                }),
              ),
        )
      })()

      const form = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-form' },
        React.createElement(
          'div',
          { className: 'dsh-workspaceplus-form-row' },
          React.createElement('input', {
            className: 'dsh-workspaceplus-input dsh-workspaceplus-input-label',
            placeholder: '标签，如 backend',
            'aria-label': '标签',
            value: draft.label,
            disabled: selected === null || state.busy,
            onChange: (event) => setDraft({ ...draft, label: event.target.value }),
          }),
          React.createElement('input', {
            className: 'dsh-workspaceplus-input dsh-workspaceplus-input-note',
            placeholder: '说明（可选）',
            'aria-label': '说明',
            value: draft.note,
            disabled: selected === null || state.busy,
            onChange: (event) => setDraft({ ...draft, note: event.target.value }),
          }),
        ),
        React.createElement(
          'div',
          { className: 'dsh-workspaceplus-form-row' },
          React.createElement('input', {
            className: 'dsh-workspaceplus-input dsh-workspaceplus-input-path',
            placeholder: '绝对路径，如 D:\\proj\\backend',
            'aria-label': '目录绝对路径',
            value: draft.path,
            disabled: selected === null || state.busy,
            onChange: (event) => setDraft({ ...draft, path: event.target.value }),
          }),
          React.createElement(
            Button,
            {
              variant: 'outline',
              disabled: selected === null || state.busy || picking || directoryPicker === null,
              onClick: () => void browse(),
            },
            picking ? '选择中…' : '浏览…',
          ),
          React.createElement(
            Button,
            { variant: 'primary', disabled: selected === null || state.busy, onClick: () => void addDirectory() },
            '添加',
          ),
        ),
      )

      const status = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-toolbar' },
        state.message === ''
          ? null
          : React.createElement(
              'span',
              { className: state.ok === false ? 'dsh-workspaceplus-error' : 'dsh-workspaceplus-ok' },
              state.message,
            ),
        // The locked header already names the root; only the unlocked picker needs it repeated.
        state.locked || selected === null
          ? null
          : React.createElement(
              'span',
              { className: 'dsh-workspaceplus-note' },
              '根目录：',
              React.createElement('span', { className: 'dsh-workspaceplus-mono' }, selected.path),
            ),
      )

      const footnote = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-note' },
        '标签映射会自动注入该工作区对话的 agent 上下文，所以直接在对话里说「改 backend」就够了。',
        '注意：DSH 沙箱把会话的可写范围限制在工作区根目录内；会话权限不是 danger-full-access 时，',
        '根目录之外的目录只能读，这里会把这类目录标注出来。',
      )

      return React.createElement(
        Modal,
        {
          open,
          onClose: closeWorkdirsDialog,
          title: '工作区目录设置',
          closeLabel: '关闭',
          description:
            '一个工作区可以登记 N 个目录，每个目录带一个标签。这份映射会自动注入该工作区对话的 agent 上下文，' +
            'agent 用标签对应的绝对路径，不会因为目录名相似而改错文件。',
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(
              Button,
              { variant: 'outline', disabled: state.busy, onClick: () => void load(requestedId) },
              '刷新',
            ),
            React.createElement(Button, { variant: 'primary', onClick: closeWorkdirsDialog }, '完成'),
          ),
        },
        React.createElement('div', { className: 'dsh-workspaceplus-dialog' }, toolbar, status, body, form, footnote),
      )
    }

    /**
     * The `workspace+` settings page, registered into `settings.section`.
     *
     * It owns exactly one preference: whether label routing runs for the default
     * (first-use) Workspace. Off by default, because that Workspace belongs to the
     * product rather than to this plugin.
     *
     * @param props - optional initial state for tests.
     * @returns the settings section element.
     */
    function WorkspaceplusSettings(props) {
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

      const toggle = async (next) => {
        patch({ busy: true })
        try {
          const result = await postOperation({ op: 'settings', settings: { [DEFAULT_WORKSPACE_SETTING]: next } })
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

      const enabled = host.settings[DEFAULT_WORKSPACE_SETTING] === true
      const unavailable = state.status === 'error'

      const row = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-settings-row' },
        React.createElement(
          'div',
          { className: 'dsh-workspaceplus-settings-text' },
          React.createElement('div', { className: 'dsh-workspaceplus-settings-title' }, '对默认工作区启用'),
          React.createElement(
            'div',
            { className: 'dsh-workspaceplus-settings-description' },
            '默认工作区是 DSH 首次启动时自动创建的那个，它默认不启用 workspace+：',
            '不在它的工作区行显示目录按钮，也不会把标签表注入它的会话上下文。',
            '其它工作区不受这个开关影响，始终启用。',
          ),
        ),
        React.createElement(Switch, {
          checked: enabled,
          disabled: state.busy || unavailable,
          label: '对默认工作区启用',
          onChange: (next) => void toggle(next),
        }),
      )

      const target = React.createElement(
        'div',
        { className: 'dsh-workspaceplus-settings-description' },
        '当前默认工作区：',
        host.defaultWorkspacePath === null
          ? state.status === 'loading'
            ? '正在读取…'
            : '未识别（这个部署还没有默认工作区记录）'
          : React.createElement('span', { className: 'dsh-workspaceplus-mono' }, host.defaultWorkspacePath),
      )

      const status = (() => {
        // A failed READ needs the transport diagnosis; a rejected WRITE only needs
        // the host's own message.
        if (state.status === 'error') {
          const unrouted = state.message.includes('404')
          return React.createElement(
            'div',
            { className: 'dsh-workspaceplus-settings-error' },
            '无法读取宿主设置：' + state.message,
            unrouted
              ? '（宿主里没有 ' + API_PATH + ' 这条路由，通常意味着 dsh 还没重启）'
              : '',
          )
        }
        if (state.message === '') return null
        return React.createElement(
          'div',
          { className: state.ok === false ? 'dsh-workspaceplus-settings-error' : 'dsh-workspaceplus-settings-ok' },
          state.message,
        )
      })()

      return React.createElement(
        'div',
        { className: 'dsh-workspaceplus-settings' },
        row,
        target,
        status,
        React.createElement(
          'div',
          { className: 'dsh-workspaceplus-settings-description' },
          '标签本身在每个工作区的「工作区目录设置」弹窗里维护：悬停左侧工作区那一行的目录按钮即可打开。',
          '关掉这个开关不会删除已登记的标签，只是让默认工作区在启用前保持原样。',
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
        { className: 'dsh-workspaceplus-panel' },
        React.createElement(
          'div',
          { className: 'dsh-workspaceplus-card' },
          React.createElement(
            'div',
            { className: 'dsh-workspaceplus-badge' },
            React.createElement(WorkdirsPanelIcon, { size: 28 }),
          ),
          React.createElement('h1', { className: 'dsh-workspaceplus-title' }, '工作区目录设置'),
          React.createElement(
            'p',
            { className: 'dsh-workspaceplus-subtitle' },
            '这个功能以弹窗形式提供：点击侧边栏工作区那一行的目录按钮即可打开。',
          ),
          React.createElement(Button, { variant: 'primary', onClick: () => openWorkdirsDialog(null) }, '现在打开'),
        ),
      )
    }

    /**
     * Append the directory button to every workspace row and keep it there.
     *
     * The shell's workspace row menu is hardcoded to Rename/Delete and exposes no
     * slot, so the trigger is appended to the row's action cluster instead. The
     * anchors are shell-emitted data attributes rather than hashed class names:
     * `data-slot="sidebar.workspaces"` on the browser outlet and
     * `data-row-key="workspace:<workspaceId>"` on a group row (that id is
     * `Workspace.id` from the host registry).
     *
     * The button is appended last in the cluster, where React's own child
     * reconciliation never has to insert before it. A MutationObserver reconciles
     * additions and removals, because React re-renders the row without knowing
     * this node exists.
     *
     * A workspace whose `enabled` flag is false (the default Workspace before the
     * user opts in) gets no button, and loses one if it is disabled while mounted —
     * `refresh()` re-runs the reconcile after a settings change.
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
          const stillWanted = live.has(row) && row.isConnected && workspaceId !== '' && isEnabledWorkspace(workspaceId)
          if (stillWanted) continue
          button.remove()
          injected.delete(row)
        }
        for (const row of rows) {
          const workspaceId = (row.getAttribute('data-row-key') ?? '').slice(ROW_KEY_PREFIX.length)
          // The synthetic "ungrouped" row carries the empty key and owns no workspace.
          if (workspaceId === '') continue
          // The default Workspace stays untouched until the user opts in.
          if (!isEnabledWorkspace(workspaceId)) continue
          const existing = injected.get(row)
          if (existing !== undefined && existing.isConnected) continue
          const actions = row.lastElementChild
          if (actions === null || actions === undefined) continue
          const button = document.createElement('button')
          button.type = 'button'
          button.className = ROW_BUTTON_CLASS
          button.title = ROW_BUTTON_LABEL
          button.setAttribute('aria-label', ROW_BUTTON_LABEL)
          button.innerHTML = ROW_BUTTON_GLYPH
          button.addEventListener('click', (event) => {
            // Keep the click off the row, whose own handler toggles the group.
            event.preventDefault()
            event.stopPropagation()
            openWorkdirsDialog(workspaceId)
          })
          actions.appendChild(button)
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
     * fallback entry, and the workspace-row buttons that open it.
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
              WorkspaceplusSettings,
            ),
          ),
        'dsh-workspaceplus: settings section',
      )

      // The dialog lives in the frame-wide overlay: the same seat the shell's own
      // workspace Rename/Delete dialogs occupy.
      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'workdirs-dialog', order: 50 }, WorkdirsDialog),
          ),
        'dsh-workspaceplus: workdirs dialog',
      )

      // The fallback entry's main key always exists; the entry itself is
      // registered only while no workspace-row button could be installed.
      ctx.effect(
        () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: WORKDIRS_PANEL_ID }, WorkdirsHintPanel),
          ),
        'dsh-workspaceplus: workdirs fallback panel',
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
        'dsh-workspaceplus: directory picker',
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
        'dsh-workspaceplus: workdirs fallback entry',
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

      // Warm the shared snapshot at boot and keep the row button in step with the
      // settings: a switch flipped in the settings page adds or removes it without
      // a reload.
      const offHostState = subscribeHostState(() => rowButtons.refresh())
      void refreshHostState()

      ctx.effect(
        () => () => {
          clearTimeout(settleTimer)
          offHostState()
          rowButtons.dispose()
        },
        'dsh-workspaceplus: workspace row buttons',
      )
    }

    exports.WORKDIRS_PANEL_ID = WORKDIRS_PANEL_ID
    exports.WORKDIRS_PANEL_LABEL = WORKDIRS_PANEL_LABEL
    exports.SETTINGS_SECTION_ID = SETTINGS_SECTION_ID
    exports.SETTINGS_SECTION_LABEL = SETTINGS_SECTION_LABEL
    exports.SETTINGS_SECTION_ORDER = SETTINGS_SECTION_ORDER
    exports.DEFAULT_WORKSPACE_SETTING = DEFAULT_WORKSPACE_SETTING
    exports.API_PATH = API_PATH
    exports.ROW_BUTTON_CLASS = ROW_BUTTON_CLASS
    exports.ROW_BUTTON_LABEL = ROW_BUTTON_LABEL
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
    exports.selectWorkspace = selectWorkspace
    exports.isOutside = isOutside
    exports.basenameOf = basenameOf
    exports.suggestLabel = suggestLabel
    exports.draftAfterPick = draftAfterPick
    exports.pickErrorMessage = pickErrorMessage
    exports.installWorkspaceRowButtons = installWorkspaceRowButtons
    exports.WorkdirsPanelIcon = WorkdirsPanelIcon
    exports.WorkdirsEntryIcon = WorkdirsEntryIcon
    exports.WorkdirsDialog = WorkdirsDialog
    exports.WorkdirsHintPanel = WorkdirsHintPanel
    exports.WorkspaceplusSettings = WorkspaceplusSettings
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
