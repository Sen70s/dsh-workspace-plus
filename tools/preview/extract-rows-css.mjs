import { readFileSync, writeFileSync } from 'node:fs'

// The workspace package injects its Rows.module.css at runtime, so it is not in
// the shell's built stylesheet: pull the string out of its client bundle and
// rewrite the generated class names to the bare ones the demo's markup uses.
//
// The hashing scheme has changed between builds:
//   older: `._0gBrGq_projectRow`  (underscore, hash, underscore, name)
//   newer: `.hIlkoa_projectRow`   (hash, underscore, name)
// so the prefix is discovered from the CSS instead of hardcoded; the harness
// silently renders unstyled if it ever stops matching (see README.md).
const source = readFileSync(process.argv[2], 'utf8')
const match = source.match(/const css\$?\d* = ("(?:[^"\\]|\\.)*")/)
if (match === null) throw new Error('Rows CSS string not found')
let css = JSON.parse(match[1])

const prefixes = new Set()
for (const m of css.matchAll(/\.(_?[A-Za-z0-9]{5,8})_([A-Za-z][A-Za-z0-9]*)/g)) prefixes.add(m[1])
if (prefixes.size === 0) throw new Error('Rows CSS: no hashed class names found; extractor is stale')
for (const prefix of prefixes) css = css.split('.' + prefix + '_').join('.')

const leftover = [...css.matchAll(/\.[A-Za-z0-9]{5,8}_[A-Za-z][A-Za-z0-9]*/g)]
if (leftover.length > 0) throw new Error('Rows CSS: class names left hashed: ' + leftover[0][0])
writeFileSync(process.argv[3], css)
console.log('wrote', process.argv[3], css.length, 'bytes; stripped prefix', [...prefixes].join(','))
