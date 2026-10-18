/**
 * Computed-style probe for the preview harness.
 *
 * A screenshot can look "unstyled but plausible": if `shell.css` carries stale
 * hashed class names, or `theme.css` lost the token sheet, the dialog still
 * renders — just wrong. So this page boots exactly like `index.html` and dumps
 * the computed values the design depends on into `#probe-styles`, where
 * `msedge --headless=new --dump-dom` can read them back.
 *
 * Measurement waits for the load event plus a macrotask, so it reads the settled
 * page: `boot.js` finishes in microtasks, but the settings view's rows land in a
 * later effect, and `window.__preview` is a plain (non-live) snapshot.
 *
 *   & msedge --headless=new --disable-gpu --virtual-time-budget=6000 --dump-dom `
 *       "file:///<...>/tools/preview/probe-styles.html?tooltip=1" |
 *     Select-String -Pattern 'probe='
 *
 * The same `?picked=1` / `?tooltip=1` / `?view=settings` flags as the screenshots.
 */
;(() => {
  const measure = () => {
    const report = { url: location.search || '(none)', errors: [] }
    const style = (selector) => {
      const el = document.querySelector(selector)
      if (el === null) return null
      const cs = getComputedStyle(el)
      const box = el.getBoundingClientRect()
      return {
        rect: [Math.round(box.left), Math.round(box.top)],
        box: [Math.round(box.width), Math.round(box.height)],
        radius: cs.borderRadius,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        font: cs.fontSize + '/' + cs.lineHeight,
        display: cs.display,
        gap: cs.gap,
        padding: cs.padding,
        cornerShape: cs.cornerShape ?? null,
      }
    }
    const root = getComputedStyle(document.documentElement)
    for (const token of [
      '--dsw-radius-xs',
      '--dsw-radius-sm',
      '--dsw-radius-md',
      '--dsw-radius-lg',
      '--dsw-radius-xl',
      '--dsw-radius-panel',
      '--dsw-font-family',
      '--ds-ease-in-out',
      '--ds-transition-duration',
    ]) {
      report[token] = root.getPropertyValue(token).trim()
    }
    report.dialog = style('[role="dialog"]')
    report.content = style('[role="dialog"] [class*="_content_"]')
    report.body = style('[role="dialog"] [class*="_body_"]')
    report.footer = style('[role="dialog"] [class*="_footer_"]')
    report.primaryButton = style('[role="dialog"] [class*="_primary_"]')
    report.ghostButton = style('[role="dialog"] [class*="_ghost_"]')
    // The plugin's own classes: proof that shell.css still styles them, and the
    // numbers the layout review wants (borders, radii, padding, alignment).
    report.dialogRoot = style('.dsh-workspace-plus-dialog')
    report.field = style('.dsh-workspace-plus-field')
    report.fieldRow = style('.dsh-workspace-plus-field-row')
    report.draft = style('.dsh-workspace-plus-draft')
    report.list = style('.dsh-workspace-plus-list')
    report.row = style('.dsh-workspace-plus-row')
    report.remove = style('.dsh-workspace-plus-remove')
    report.add = style('.dsh-workspace-plus-add')
    report.pluginFooter = style('.dsh-workspace-plus-footer')
    report.input = style('.dsh-workspace-plus-input')
    // Present only on the pages that show them (`?tooltip=1`, `?view=settings`).
    report.outside = style('.dsh-workspace-plus-row-outside')
    report.tooltip = style('[role="tooltip"]')
    report.tooltipLabel = style('[role="tooltip"] [class*="_label_"]')
    report.switch = style('[role="switch"]')
    report.thumb = style('[role="switch"] > [class*="_thumb_"]')
    report.preview = window.__preview ?? null

    let pre = document.getElementById('probe-styles')
    if (pre === null) {
      pre = document.createElement('pre')
      pre.id = 'probe-styles'
      document.body.appendChild(pre)
    }
    pre.textContent = 'probe=' + JSON.stringify(report)
    document.title = 'probe-styles-ready'
  }
  window.addEventListener('error', (event) => {
    const report = { url: location.search || '(none)', fatal: String(event.message) }
    document.title = 'probe-styles-error'
    const pre = document.createElement('pre')
    pre.id = 'probe-styles'
    pre.textContent = 'probe=' + JSON.stringify(report)
    document.body.appendChild(pre)
  })
  // The tooltip bubble and the settings rows land in effects scheduled after the
  // load event, so wait for a timer — `--virtual-time-budget` fast-forwards it.
  window.addEventListener('load', () => setTimeout(measure, 250))
})()
