# Design preview harness

A repeatable way to *look* at the plugin's UI without restarting the running DSH:
it renders the real `lib/client.js` (the same file the shell loads) with real
React and the shell's own stylesheet, then screenshots it with headless Edge.

The four images in [`../../docs/`](../../docs) — the ones the README embeds — are
produced here. This is a design check, not a test: behaviour is asserted in
[`../verify.mjs`](../verify.mjs), and nothing in this folder runs in CI or ships
in the package.

## What it needs (not committed)

The pages load files copied out of the installed DSH:

| File | Where it comes from |
| --- | --- |
| `client.js` | this repo's `lib/client.js` |
| `react.development.js`, `react-dom.development.js` | `react@18/umd/` in the shell's dependency tree |
| `shell.css` | the shell's built stylesheet (`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css`) |
| `theme.css` | the `design_platform_css_default` string in `@deepseek-ai/dsh-client-ui-theme/lib/client.js` (the theme plugin injects it at runtime instead of shipping a `.css`) |
| `vendor.css` | the shell's other built stylesheet (`.../assets/vendor-*.css`) |
| `rows.css` | the `Rows.module.css` string inside `@deepseek-ai/dsh-client-ui-workspace/lib/client.js` — that package injects it at runtime too, so it is absent from `shell.css` |

Rebuild them from the DSH checkout on this machine (`<app>/resources/app.asar/dsh/…`,
e.g. via an asar extraction) and the plugin profile's `node_modules/react`:

```sh
cp lib/client.js tools/preview/client.js
cp <react>/umd/react.development.js <react>/umd/react-dom.development.js tools/preview/
cp <dsh-web-frontend>/dist/assets/index-*.css  tools/preview/shell.css
cp <dsh-web-frontend>/dist/assets/vendor-*.css tools/preview/vendor.css
node extract-rows-css.mjs <dsh-client-ui-workspace>/lib/client.js rows.css
node -e "…pull design_platform_css_default out of the theme bundle…" > theme.css
```

Two traps, both of which fail *quietly* — an unstyled but perfectly rendered page:

> `harness.js` hardcodes the class names the shell's build generated for the
> primitives (`_dialog_17i0t_33`, `_button_1rv3m_2`, …), including the leading
> underscore. CSS-module class names are hashed per build; after a DSH upgrade,
> re-read them from `shell.css` — `list-classes.mjs` prints the ones matching a
> pattern:
>
> ```sh
> node list-classes.mjs shell.css 'switch|thumb'
> ```

> Headless capture grabs its frame at the load event, and React's updates land in
> a microtask, so the pages render through `ReactDOM.flushSync`. Drop that and the
> screenshots come back empty.

## Run it

```powershell
$p = "file:///D:/plugins/dsh/dsh-workspaceplus/tools/preview"
$d = "D:/plugins/dsh/dsh-workspaceplus/docs"

./shot.ps1 -Url "$p/index.html"                  -Out "$d/dialog-default.png" -Width 1000 -Height 720
./shot.ps1 -Url "$p/index.html?picked=1"         -Out "$d/dialog-picked.png"  -Width 1000 -Height 720
./shot.ps1 -Url "$p/index.html?tooltip=1"        -Out "$d/dialog-tooltip.png" -Width 1000 -Height 720
./shot.ps1 -Url "$p/index.html?view=settings"    -Out "$d/settings.png"        -Width 1000 -Height 460
./shot.ps1 -Url "$p/sidebar.html"                -Out "$d/row-button.png"      -Width 420  -Height 210
```

| Page | Flags | Shows |
| --- | --- | --- |
| `index.html` | — | the dialog, empty form |
| `index.html` | `?picked=1` | a directory just picked: path and guessed label filled in |
| `index.html` | `?tooltip=1` | the shield badge's warning bubble |
| `index.html` | `?view=settings` | the settings page's per-workspace switches |
| `sidebar.html` | — | the workspace row, with this plugin's button seated between 「更多」and 「新会话」 |

`sidebar.html` is the one worth a second look: its row markup is the shell's own,
and this plugin's button is **not** hand-written into the page — the boot script
calls the real `installWorkspaceRowButtons()` against that DOM, so the screenshot
shows the actual injection, seat and all. The page forces the hover state (the
shell only reveals the action cluster on hover) because a headless capture cannot
hover.
