# Design preview harness

A repeatable way to *look* at the plugin's UI without restarting the running DSH:
it renders the real `lib/client.js` (the same file the shell loads) with real
React and the shell's own stylesheet, then screenshots it with headless Edge.

The images in [`../../docs/`](../../docs) — the ones the README embeds — are
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
| `theme.css` | every sheet `@deepseek-ai/dsh-client-ui-theme/lib/client.js` injects at runtime (`base.css`, `corner-shape.css`, `design-platform.css`, `focus.css`, …) — the package ships no `.css`, and `base.css` is the only place `--dsw-radius-md` and friends are defined |
| `vendor.css` | the shell's other built stylesheet (`.../assets/vendor-*.css`) |
| `rows.css` | the `Rows.module.css` string inside `@deepseek-ai/dsh-client-ui-workspace/lib/client.js` — that package injects it at runtime too, so it is absent from `shell.css` |

Ground truth is the build that is **actually running**: the desktop app's
`resources/app.asar`, whose host process is the one holding that path. A plain
asar needs no tooling — `[8-byte pickle][JSON directory]`, file data at
`16 + headerSize` — and `extract-shell-assets.mjs` reads it that way. Do not slice
by hand: an off-by-two start (the tail of the header) corrupts the first
`@font-face` rule and then reads as a font bug instead of an extraction bug.

```powershell
$asar = 'D:\software\deepseek\resources\app.asar'
$tmp  = Join-Path $env:TEMP 'dsh-preview'
$fw   = '/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets'

node extract-shell-assets.mjs cat $asar "$fw/index-BxpfOGf3.css" shell.css
node extract-shell-assets.mjs cat $asar "$fw/vendor-DV2921Zo.css" vendor.css

node extract-shell-assets.mjs cat $asar '/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js' "$tmp/theme-client.js"
node extract-theme-css.mjs "$tmp/theme-client.js" theme.css

node extract-shell-assets.mjs cat $asar '/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js' "$tmp/workspace-client.js"
node extract-rows-css.mjs "$tmp/workspace-client.js" rows.css
```

The asset filenames are hashed per build; `extract-shell-assets.mjs list
<app.asar> <regex>` finds the current ones after a DSH upgrade, e.g.
`node extract-shell-assets.mjs list $asar 'dsh-web-frontend/dist/assets/.*\.css$'`.

## The traps, each of which fails *quietly*

An unstyled but perfectly rendered page is the failure mode, so never trust the
pixels alone — run the probe below.

> `harness.js` hardcodes the class names the shell's build generated for the
> primitives (`_dialog_o6lrb_33`, `_button_1rv3m_2`, …), including the leading
> underscore; `rows.css`'s names are rewritten to bare ones by
> `extract-rows-css.mjs`. CSS-module names are hashed per build, so after a DSH
> upgrade re-read them:
>
> ```sh
> node list-classes.mjs shell.css 'dialog|mask|content|body|footer|close|title'
> node list-classes.mjs shell.css 'button|primary|ghost|outline|icon'
> node list-classes.mjs shell.css 'bubble|switch|thumb'
> ```
>
> The primitives' markup lives in the shell's JS bundle (this build has no
> separate `dsh-client-ui-primitives` package), so confirm every name against the
> class maps there — the object literal next to the string is the ground truth:
>
> ```sh
> node extract-shell-assets.mjs cat $asar "$fw/index-CN7NIWNw.js" "$tmp/frontend.js"
> rg -o '.{300}_dialog_o6lrb_33.{900}' "$tmp/frontend.js"
> ```
>
> The rows hashing scheme has changed once already
> (`._0gBrGq_projectRow` → `.hIlkoa_projectRow`); `extract-rows-css.mjs` now
> discovers the prefix from the CSS and throws when it finds none, rather than
> writing a silently unstyled sheet.

> Headless capture grabs its frame at the load event, and React's updates land in
> a microtask, so the pages render through `ReactDOM.flushSync`. Drop that and the
> screenshots come back empty.

## Check it, don't just look at it

`probe-styles.html` boots exactly like `index.html` and writes the computed values
the design depends on into `#probe-styles` — tokens, the card's radius, the
buttons', the tooltip bubble's, the settings switch's, and the plugin's own field
rows. It waits for the load event plus a timer, because the tooltip bubble and the
settings rows land in effects *after* load.

Edge is a GUI-subsystem binary, so PowerShell cannot capture `--dump-dom` through
its own pipeline (the redirect comes back empty); let `cmd /c` do the redirect:

```powershell
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$url  = 'file:///D:/plugins/dsh/dsh-workspaceplus/tools/preview/probe-styles.html'
cmd /c "`"$edge`" --headless=new --disable-gpu --virtual-time-budget=8000 --dump-dom `"$url`" > `"$env:TEMP\probe.html`""
rg -o 'probe=\{[^<]*' "$env:TEMP\probe.html"
```

`?picked=1` / `?tooltip=1` / `?view=settings` work here too, so each screenshot's
state can be measured as well as viewed.

`window.__preview` is the harness's own summary of what it rendered: directory
rows (`.dsh-workspace-plus-row` — the add row and the empty row are field rows,
so they are not counted), `fieldRows`, `badges`, `bubbles`, `switches`, `inputs`,
`draft`, `addText`, `cardWidth` and `pickerCalls`. It is a plain snapshot, so
`boot.js` takes it 300 ms after load — long enough for the badge's 120 ms tooltip
delay and for the settings rows to land.

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
| `index.html` | — | the dialog at rest: the identity field, the 「目录」 section, the grouped list, the add row, and the split footer |
| `index.html` | `?picked=1` | a directory just picked: its path in the picker row, and the label/note row that only then exists, with the guessed label |
| `index.html` | `?tooltip=1` | the shield badge's warning bubble |
| `index.html` | `?view=settings` | the settings page's per-workspace switches |
| `sidebar.html` | — | the workspace row, with this plugin's button seated between 「更多」and 「新会话」 |

`-Url` must be a `file:///` URL. A bare `D:/…/index.html?picked=1` path is read
as a *filename*, so the page never loads and Edge writes nothing — while still
exiting 0, which makes it look like a screenshot bug rather than a typo.

`sidebar.html` is the one worth a second look: its row markup is the shell's own,
and this plugin's button is **not** hand-written into the page — the boot script
calls the real `installWorkspaceRowButtons()` against that DOM, so the screenshot
shows the actual injection, seat and all. The page forces the hover state (the
shell only reveals the action cluster on hover) because a headless capture cannot
hover.
