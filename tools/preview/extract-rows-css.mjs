import { readFileSync, writeFileSync } from 'node:fs'

// The workspace package injects its Rows.module.css at runtime, so it is not in
// the shell's built stylesheet: pull the string out of its client bundle and
// rewrite the generated class names to the bare ones the demo's markup uses.
const source = readFileSync(process.argv[2], 'utf8')
const match = source.match(/const css\$?\d* = ("(?:[^"\\]|\\.)*")/)
if (match === null) throw new Error('Rows CSS string not found')
// This package names its generated classes `._<hash>_<name>` (no trailing line
// number, unlike the shell's own build), so the rewrite is name-only.
const css = JSON.parse(match[1]).replace(/\._0gBrGq_([A-Za-z]+)/g, '.$1')
writeFileSync(process.argv[3], css)
console.log('wrote', process.argv[3], css.length, 'bytes')
