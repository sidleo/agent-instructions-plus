/**
 * Quick test: run discovery against the test directories on Desktop.
 * Usage: npx tsx test-discovery.ts
 */
import { discoverInstructionFiles, previewRoots } from './src/discovery.ts'
import { normalizeConfig } from './src/config.ts'

const testBase = '/Users/zhang3/Desktop/instruction-scan-test'

// ── Test 1: scanProject mode ──────────────────────────────────────
console.log('═══ Test 1: scanProject (cwd = project-root/src) ═══')
const projectConfig = normalizeConfig({
  scanCwd: true,
  scanProject: true,
  scanParents: false,
  scanGlobal: false,
})
const projectFiles = discoverInstructionFiles(projectConfig, `${testBase}/project-root/src`, 1_048_576)
for (const f of projectFiles) {
  console.log(`  [rank=${f.rank}] [${f.source}] ${f.displayPath}`)
  console.log(`         content: ${f.content.trim().substring(0, 50)}...`)
}
console.log(`  Total: ${projectFiles.length} files\n`)

// ── Test 2: scanParents mode ──────────────────────────────────────
console.log('═══ Test 2: scanParents (cwd = workspace/a/b/c) ═══')
const parentsConfig = normalizeConfig({
  scanCwd: true,
  scanProject: false,
  scanParents: true,
  scanGlobal: false,
})
const parentsFiles = discoverInstructionFiles(parentsConfig, `${testBase}/workspace/a/b/c`, 1_048_576)
for (const f of parentsFiles) {
  console.log(`  [rank=${f.rank}] [${f.source}] ${f.displayPath}`)
  console.log(`         content: ${f.content.trim().substring(0, 50)}...`)
}
console.log(`  Total: ${parentsFiles.length} files\n`)

// ── Test 3: same-directory dedup check ────────────────────────────
console.log('═══ Test 3: same-directory dedup (project-root/src) ═══')
const dedupConfig = normalizeConfig({
  scanCwd: false,
  scanProject: true,
  scanParents: false,
  scanGlobal: false,
})
const dedupFiles = discoverInstructionFiles(dedupConfig, `${testBase}/project-root/src`, 1_048_576)
for (const f of dedupFiles) {
  console.log(`  [rank=${f.rank}] ${f.displayPath}  (${Buffer.byteLength(f.content, 'utf8')} bytes)`)
}
console.log(`  Total: ${dedupFiles.length} files (expect 2: AGENTS.md + CLAUDE.md, different content)`)
console.log(`  NOTE: original agent-instructions would load BOTH because content differs.\n`)

// ── Test 4: roots preview ─────────────────────────────────────────
console.log('═══ Test 4: roots preview (cwd = workspace/a/b/c) ═══')
const roots = previewRoots(parentsConfig, `${testBase}/workspace/a/b/c`)
for (const r of roots) {
  console.log(`  [rank=${r.rank}] [${r.source}] ${r.dir}`)
}
console.log(`  Total: ${roots.length} scan roots\n`)

// ── Test 5: local overlay ─────────────────────────────────────────
console.log('═══ Test 5: local overlay (cwd = project-root/src/utils) ═══')
const overlayConfig = normalizeConfig({
  scanCwd: true,
  scanProject: false,
  scanParents: false,
  scanGlobal: false,
})
const overlayFiles = discoverInstructionFiles(overlayConfig, `${testBase}/project-root/src/utils`, 1_048_576)
for (const f of overlayFiles) {
  console.log(`  [rank=${f.rank}] ${f.displayPath}`)
  console.log(`         content: ${f.content.trim().substring(0, 60)}...`)
}
console.log(`  Total: ${overlayFiles.length} files\n`)

console.log('═══ All tests complete ═══')

// ── Test 6: same-content dedup ────────────────────────────────────
console.log('\n═══ Test 6: same-content dedup (same-content dir) ═══')
const sameContentConfig = normalizeConfig({
  scanCwd: true,
  scanProject: false,
  scanParents: false,
  scanGlobal: false,
})
const sameContentFiles = discoverInstructionFiles(sameContentConfig, `${testBase}/project-root/same-content`, 1_048_576)
for (const f of sameContentFiles) {
  console.log(`  [rank=${f.rank}] ${f.displayPath}  (${Buffer.byteLength(f.content, 'utf8')} bytes)`)
}
console.log(`  Total: ${sameContentFiles.length} files (expect 1: content-based dedup collapses CLAUDE.md)`)
