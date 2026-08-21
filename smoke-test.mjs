/**
 * Smoke test: exercise the built lib modules without a host.
 * - config normalization
 * - four-layer scan directories
 * - discovery files
 * - baseline load + render
 * - scope key round trip
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const lib = require('./lib/index.js')

const cfg = lib.normalizeConfig({
  scanCwd: true,
  scanProject: true,
  scanParents: false,
  scanGlobal: true,
  instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'],
  localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'],
  projectRootMarkers: ['.git'],
  dshHome: '~/.dsh',
  maxBytes: 65536,
  maxSourceBytes: 1048576,
})

const cwd = '/Users/zhang3/yh_zhang3/Project/dsh插件'

console.log('=== config normalized ===')
console.log(JSON.stringify(cfg))

console.log('\n=== scanDirectories (cwd=' + cwd + ') ===')
for (const d of lib.scanDirectories(cfg, cwd)) {
  console.log(`  [${d.rank}] src=${d.source} scope=${JSON.stringify(d.scope)} dir=${d.dir}`)
}

console.log('\n=== discoverInstructionFiles ===')
for (const f of lib.discoverInstructionFiles(cfg, cwd, 1_048_576)) {
  console.log(`  [${f.rank}] ${f.source} ${f.displayPath} (${Buffer.byteLength(f.content, 'utf8')}B)`)
}

console.log('\n=== loadBaselineInstructionSet (node-fs fallback) ===')
const set = await lib.loadBaselineInstructionSet(cfg, cwd)
if (set === undefined) {
  console.log('  (nothing loaded)')
} else {
  console.log(`  observed=${set.observed.length} included=${set.included.length}`)
  for (const f of set.included) console.log(`  - ${f.displayPath} (${Buffer.byteLength(f.content, 'utf8')}B)`)
  console.log('  --- rendered text (first 700 chars) ---')
  console.log(set.rendered.text.slice(0, 700))
  console.log('  --- omitted/truncated ---', JSON.stringify({ omitted: set.rendered.omitted.map(o => o.displayPath), truncated: set.rendered.truncated }))
}

console.log('\n=== baselineInstructionState ===')
const b = lib.baselineInstructionState(set?.included ?? [])
for (const [scope, ch] of b.changes) console.log(`  scope=${JSON.stringify(scope)} action=${ch.action} path=${ch.path} digest=${ch.digest?.slice(0, 8)}`)

console.log('\n=== scope key round trip ===')
const k = lib.candidateScopeKey('user-global', 'AGENTS.md')
const d = lib.decodeScopeKey(k)
console.log(`  candidateScopeKey('user-global','AGENTS.md') = ${JSON.stringify(k)} -> dir=${d.directory} name=${d.candidateName}`)
const k2 = lib.instructionScopeKey('aaa/AGENTS.md')
console.log(`  instructionScopeKey('aaa/AGENTS.md') = ${JSON.stringify(k2)}`)

console.log('\n=== done ===')