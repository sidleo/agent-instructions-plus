/**
 * Generate `tsconfig` paths for the DSH runtime type packages.
 *
 * `src/` imports TYPES from `@deepseek-ai/dsh-*` and `@deepseek-ai/cordis`, but
 * those packages are not published at any version npm can resolve (the
 * registry only carries stale `rc` builds) and DSH injects them at runtime.
 * Without a resolution base, `tsc` reports ~28 "Cannot find module" errors,
 * which masks real type errors.
 *
 * This script resolves each package from the RUNNING DSH installation — the
 * active profile first, then this package — and writes the absolute paths to
 * `.dsh-types/tsconfig.paths.json`, which `tsconfig.json` extends. That file is
 * gitignored because the paths are machine-specific; this script is the
 * portable, committed part.
 *
 * Run it before `tsc` (and after switching DSH installs):
 *   node scripts/resolve-dsh-types.mjs
 *
 * @module scripts/resolve-dsh-types
 */

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Packages `src/` imports types from (client-only packages ship no types). */
const PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-home-paths',
]

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** Resolution bases, most specific first. */
function bases() {
  const list = []
  // The active profile is the real runtime environment: `dsh` sets this.
  if (process.env.DSH_PROFILE_DIR) {
    list.push(join(process.env.DSH_PROFILE_DIR, 'package.json'))
  }
  // Fall back to this package, which works for a hoisted install.
  list.push(join(packageRoot, 'package.json'))
  return list
}

const paths = {}
const missing = []
for (const pkg of PACKAGES) {
  let resolved = false
  for (const base of bases()) {
    try {
      const manifest = createRequire(base).resolve(`${pkg}/package.json`)
      paths[pkg] = [join(dirname(manifest), 'lib/types/index.d.ts')]
      resolved = true
      break
    } catch { /* try the next base */ }
  }
  if (!resolved) missing.push(pkg)
}

const outDir = join(packageRoot, '.dsh-types')
mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'tsconfig.paths.json'),
  JSON.stringify({ compilerOptions: { paths } }, null, 2) + '\n',
)

console.log(`resolve-dsh-types: ${Object.keys(paths).length}/${PACKAGES.length} resolved`)
for (const pkg of Object.keys(paths)) console.log(`  ${pkg}`)
if (missing.length > 0) {
  // Not fatal: a missing package only means the error for it stays a
  // "Cannot find module" instead of a real diagnostic.
  console.warn(`  unresolved (types unavailable): ${missing.join(', ')}`)
}
