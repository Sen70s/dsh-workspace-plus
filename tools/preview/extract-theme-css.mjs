/**
 * Pull the theme plugin's inlined stylesheets out of its built client bundle.
 *
 * `@deepseek-ai/dsh-client-ui-theme` ships no `.css`: it declares each sheet as a
 * JS string literal (`base_css_default`, `design_platform_css_default`, …) and
 * appends a `<style>` tag per entry at runtime. The preview needs the same layer,
 * so this writes the concatenation of those sheets, in the plugin's own
 * injection order, as plain CSS.
 *
 * Usage:
 *   node extract-theme-css.mjs <theme>/lib/client.js <out.css> [name...]
 *
 * With no names, every sheet in the bundle's `STYLES` table is written.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [source, out, ...only] = process.argv.slice(2)
if (source === undefined || out === undefined) {
  throw new Error('usage: extract-theme-css.mjs <theme-client.js> <out.css> [name...]')
}
const bundle = readFileSync(source, 'utf8')

/** Read one `var <name> = "<js string literal>"` declaration. */
function pull(name) {
  const start = bundle.indexOf('var ' + name + ' = "')
  if (start < 0) throw new Error('theme bundle: no string literal named ' + name)
  let i = start + 'var '.length + name.length + ' = "'.length
  let raw = ''
  let escaped = false
  for (; i < bundle.length; i += 1) {
    const char = bundle[i]
    if (escaped) {
      raw += char
      escaped = false
      continue
    }
    if (char === '\\') {
      raw += char
      escaped = true
      continue
    }
    if (char === '"') break
    raw += char
  }
  return JSON.parse('"' + raw + '"')
}

// The `STYLES` table is the plugin's injection order; keep it exactly.
const table = bundle.match(/const STYLES = \[([\s\S]*?)\n\t\t\];/)
if (table === null) throw new Error('theme bundle: STYLES table not found')
const names = [...table[1].matchAll(/\["([^"]+)", (\w+)\]/g)].map((m) => [m[1], m[2]])
if (names.length === 0) throw new Error('theme bundle: STYLES table is empty')

const wanted = only.length === 0 ? names : names.filter(([, variable]) => only.includes(variable))
const missing = only.filter((name) => !names.some(([, variable]) => variable === name))
if (missing.length > 0) throw new Error('theme bundle: not in STYLES: ' + missing.join(', '))

const css = wanted.map(([file, variable]) => pull(variable)).join('\n')
writeFileSync(out, css)
console.log('wrote', out, css.length, 'bytes from', wanted.length, 'sheets:', wanted.map(([f]) => f).join(' '))
