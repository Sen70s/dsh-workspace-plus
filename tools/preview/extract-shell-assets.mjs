/**
 * Rebuild the preview harness's shell assets from the DSH build that is actually
 * running, i.e. the desktop app's `app.asar` (a plain asar archive, no tooling
 * needed: `[8-byte pickle][JSON directory]`, file data at 16 + headerSize).
 *
 * Usage:
 *   node extract-shell-assets.mjs list  <app.asar> <regex> [regex...]
 *   node extract-shell-assets.mjs cat   <app.asar> <inner/path> [outFile]
 *
 * Paths inside the archive always start with a leading `/`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

const [mode, archivePath, ...rest] = process.argv.slice(2)
if (mode === undefined || archivePath === undefined) {
  throw new Error('usage: extract-shell-assets.mjs list|cat <app.asar> ...')
}

const fd = readFileSync(archivePath)
const pickleSize = fd.readUInt32LE(4)
const headerSize = fd.readUInt32LE(12)
const dataOffset = 8 + pickleSize
if (dataOffset !== 16 + headerSize) throw new Error('asar: unexpected header layout')
const header = JSON.parse(fd.subarray(16, 16 + headerSize).toString('utf8'))

/** Flatten the asar directory tree into `{ '/inner/path': entry }`. */
function flatten(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix + '/' + name
    if (child.files !== undefined) flatten(child, path, out)
    else out[path] = child
  }
  return out
}
const files = flatten(header, '', {})

function read(inner) {
  const entry = files[inner]
  if (entry === undefined) throw new Error('asar: no such file: ' + inner)
  return fd.subarray(dataOffset + Number(entry.offset), dataOffset + Number(entry.offset) + Number(entry.size))
}

if (mode === 'list') {
  const patterns = rest.map((r) => new RegExp(r, 'i'))
  const hits = Object.keys(files).filter((p) => patterns.some((re) => re.test(p)))
  for (const hit of hits.sort()) console.log(files[hit].size.toString().padStart(9), hit)
  console.error('liste', hits.length, 'of', Object.keys(files).length, 'entries')
} else if (mode === 'cat') {
  const [inner, outFile] = rest
  const bytes = read(inner)
  if (outFile === undefined) process.stdout.write(bytes)
  else {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, bytes)
    console.log('wrote', outFile, bytes.length, 'bytes from', inner)
  }
} else {
  throw new Error('unknown mode: ' + mode)
}
