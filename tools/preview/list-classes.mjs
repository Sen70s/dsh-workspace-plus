import { readFileSync } from 'node:fs'

const css = readFileSync(process.argv[2], 'utf8')
const wanted = process.argv[3]
const out = new Set()
for (const m of css.matchAll(/\._([A-Za-z0-9-]+)_([a-z0-9]+)_(\d+)/g)) {
  if (new RegExp(wanted, 'i').test(m[1])) out.add(`${m[1]}_${m[2]}_${m[3]}`)
}
console.log([...out].sort().join('\n'))
