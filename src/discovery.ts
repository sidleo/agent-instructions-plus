/**
 * Four-layer instruction-file discovery with scanParents support.
 *
 * Scanning priority (highest → lowest):
 *   1. scanCwd       — session working directory
 *   2. scanProject   — project root (marker-bearing ancestor) to cwd chain
 *      scanParents   — every ancestor from cwd upward to filesystem root (mutually exclusive)
 *   3. scanGlobal    — user-global $DSH_HOME
 *
 * @module @sidleo3/agent-instructions-plus/discovery
 */

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import type { InstructionScanConfig } from './config.ts'

/** A discovered instruction file. */
export interface DiscoveredFile {
  absolutePath: string
  displayPath: string
  content: string
  source: 'cwd' | 'project' | 'parents' | 'global'
  rank: number
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function fileExists(path: string): boolean {
  try {
    const info = statSync(path, { throwIfNoEntry: false })
    return info !== undefined && info.isFile()
  } catch {
    return false
  }
}

function readFileBounded(path: string, maxBytes: number): string | undefined {
  try {
    const info = statSync(path, { throwIfNoEntry: false })
    if (info === undefined || !info.isFile()) return undefined
    if (info.size > maxBytes) return undefined
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function isMarkerDir(path: string, markers: readonly string[]): boolean {
  for (const marker of markers) {
    // A root marker may be a directory (e.g. `.git`) or a file (e.g.
    // `pyproject.toml`); existence is what identifies the root, not type.
    try {
      const info = statSync(join(path, marker), { throwIfNoEntry: false })
      if (info !== undefined) return true
    } catch { /* keep looking */ }
  }
  return false
}

/**
 * Walk upward to the first directory containing a configured root marker.
 * Returns cwd when no marker exists.
 */
function findProjectRoot(cwd: string, markers: readonly string[]): string {
  let current = resolve(cwd)
  for (let i = 0; i < 64; i++) {
    if (isMarkerDir(current, markers)) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
  return resolve(cwd)
}

/**
 * Build the inclusive root-to-cwd directory chain, ordered broadest → most specific.
 */
function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Walk all ancestors from cwd upward to filesystem root, with no depth limit.
 * Returns directories ordered broadest → most specific (root first, cwd last).
 */
function allAncestors(cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  for (let i = 0; i < 256; i++) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return chain.reverse()
}

function allExistingFiles(
  dir: string,
  displayBase: string,
  candidates: readonly string[],
  maxSourceBytes: number,
): DiscoveredFile[] {
  const found: DiscoveredFile[] = []
  for (const candidate of candidates) {
    const path = join(dir, candidate)
    if (!fileExists(path)) continue
    const content = readFileBounded(path, maxSourceBytes)
    if (content === undefined) continue
    found.push({
      absolutePath: path,
      displayPath: relative(displayBase, path) || candidate,
      content,
      source: 'project', // will be overwritten by caller
      rank: 0, // will be overwritten by caller
    })
  }
  return found
}

/**
 * Per-directory content-based dedup: same trimmed content → keep first candidate.
 * Matches the original agent-instructions `dedupInstructionFilesByDirectory` behavior.
 */
function dedupByDirectory(files: DiscoveredFile[]): DiscoveredFile[] {
  const keptDigestsByDir = new Map<string, Set<string>>()
  const kept: DiscoveredFile[] = []
  for (const file of files) {
    const dir = dirname(file.displayPath)
    let digests = keptDigestsByDir.get(dir)
    if (digests === undefined) {
      digests = new Set()
      keptDigestsByDir.set(dir, digests)
    }
    const digest = createHash('sha1').update(file.content.trim()).digest('hex')
    if (digests.has(digest)) continue
    digests.add(digest)
    kept.push(file)
  }
  return kept
}

/**
 * Resolve the display/scope base the current configuration uses for
 * non-global layers: the project root in project mode, the filesystem root in
 * parents mode, or the cwd itself when neither medium layer is enabled.
 */
export function scanDisplayBase(config: InstructionScanConfig, cwd: string): string {
  const resolved = resolve(cwd)
  if (config.scanProject) return findProjectRoot(resolved, config.projectRootMarkers)
  if (config.scanParents) return '/'
  return resolved
}

/**
 * Discover instruction files across all configured layers.
 *
 * @param config - normalized plugin configuration.
 * @param cwd - session working directory.
 * @param maxSourceBytes - per-file content size cap.
 * @returns discovered files in priority order (highest rank first).
 */
export function discoverInstructionFiles(
  config: InstructionScanConfig,
  cwd: string,
  maxSourceBytes: number,
): DiscoveredFile[] {
  const resolved = resolve(cwd)
  const seen = new Set<string>()
  const files: DiscoveredFile[] = []
  let rank = 0

  function addFiles(discovered: DiscoveredFile[], source: DiscoveredFile['source']): void {
    for (const file of discovered) {
      if (seen.has(file.absolutePath)) continue
      seen.add(file.absolutePath)
      files.push({ ...file, source, rank })
      rank++
    }
  }

  function scanDir(dir: string, displayBase: string): DiscoveredFile[] {
    const base = allExistingFiles(dir, displayBase, config.instructionFileCandidates, maxSourceBytes)
    const local = allExistingFiles(dir, displayBase, config.localInstructionFileCandidates, maxSourceBytes)
    // Per-directory dedup: same trimmed content → keep first (base before local)
    return dedupByDirectory(base.concat(local))
  }

  // Layer 1: scanCwd (highest priority)
  if (config.scanCwd) {
    addFiles(scanDir(resolved, resolved), 'cwd')
  }

  // Layer 2: scanProject or scanParents (mutually exclusive)
  if (config.scanProject) {
    const projectRoot = findProjectRoot(resolved, config.projectRootMarkers)
    const chain = ancestorChain(projectRoot, resolved)
    for (const dir of chain) {
      addFiles(scanDir(dir, projectRoot), 'project')
    }
  } else if (config.scanParents) {
    const chain = allAncestors(resolved)
    // Use filesystem root as display base so paths are absolute
    const root = chain.length > 0 ? chain[0] : '/'
    for (const dir of chain) {
      addFiles(scanDir(dir, root), 'parents')
    }
  }

  // Layer 3: scanGlobal (lowest priority)
  if (config.scanGlobal) {
    const home = config.dshHome.replace(/^~/, process.env.HOME ?? '~')
    const homeDir = resolve(home)
    const globalFile = join(homeDir, 'AGENTS.md')
    if (fileExists(globalFile)) {
      const content = readFileBounded(globalFile, maxSourceBytes)
      if (content !== undefined && !seen.has(globalFile)) {
        seen.add(globalFile)
        files.push({
          absolutePath: globalFile,
          displayPath: `${config.dshHome}/AGENTS.md`,
          content,
          source: 'global',
          rank,
        })
        rank++
      }
    }
  }

  return files
}

/**
 * Discover instruction files and return metadata without reading content.
 * Used for the roots/preview RPC endpoint.
 */
export function previewRoots(
  config: InstructionScanConfig,
  cwd: string,
): Array<{ dir: string; source: string; rank: number }> {
  const resolved = resolve(cwd)
  const seen = new Set<string>()
  const roots: Array<{ dir: string; source: string; rank: number }> = []
  let rank = 0

  function addDir(dir: string, source: string): void {
    if (seen.has(dir)) return
    seen.add(dir)
    roots.push({ dir, source, rank })
    rank++
  }

  if (config.scanCwd) {
    addDir(resolved, 'cwd')
  }

  if (config.scanProject) {
    const projectRoot = findProjectRoot(resolved, config.projectRootMarkers)
    for (const dir of ancestorChain(projectRoot, resolved)) {
      addDir(dir, 'project')
    }
  } else if (config.scanParents) {
    for (const dir of allAncestors(resolved)) {
      addDir(dir, 'parents')
    }
  }

  if (config.scanGlobal) {
    const home = config.dshHome.replace(/^~/, process.env.HOME ?? '~')
    addDir(resolve(home), 'global')
  }

  return roots
}

/**
 * One directory selected for instruction scanning, with its logical scope
 * identity and display base.
 */
export interface ScanDirectory {
  /** Absolute directory path. */
  dir: string
  /**
   * Logical scope directory used to key per-candidate instruction state:
   * `user-global` for the home layer, or the directory relative to that
   * layer's display base (`.` for the base itself).
   */
  scope: string
  /** Base used to compute relative instruction display paths. */
  displayBase: string
  /** Scanning layer that selected the directory. */
  source: 'cwd' | 'project' | 'parents' | 'global'
  rank: number
}

/**
 * Enumerate the scan directories the current configuration selects for a cwd,
 * ordered from highest priority to lowest and deduplicated by absolute path.
 * This is the injection pipeline's counterpart of {@link previewRoots}:
 * discovery reads files for the GUI/RPC, scan directories drive the
 * per-candidate scope model used by reconciliation.
 */
export function scanDirectories(config: InstructionScanConfig, cwd: string): ScanDirectory[] {
  const resolved = resolve(cwd)
  const seen = new Set<string>()
  const dirs: ScanDirectory[] = []
  let rank = 0

  const addDir = (dir: string, source: ScanDirectory['source'], displayBase: string): void => {
    if (seen.has(dir)) return
    seen.add(dir)
    const scope = source === 'global' ? 'user-global' : relative(displayBase, dir) || '.'
    dirs.push({ dir, scope, displayBase, source, rank })
    rank++
  }

  if (config.scanCwd) {
    // cwd layer shares the same display base as the medium layer so identical
    // absolute directories collapse to one scope across cwd/project.
    const base = config.scanProject
      ? findProjectRoot(resolved, config.projectRootMarkers)
      : config.scanParents ? '/' : resolved
    addDir(resolved, 'cwd', base)
  }

  if (config.scanProject) {
    const projectRoot = findProjectRoot(resolved, config.projectRootMarkers)
    for (const dir of ancestorChain(projectRoot, resolved)) {
      addDir(dir, 'project', projectRoot)
    }
  } else if (config.scanParents) {
    const chain = allAncestors(resolved)
    const root = chain.length > 0 ? chain[0] : '/'
    for (const dir of chain) {
      addDir(dir, 'parents', root)
    }
  }

  if (config.scanGlobal) {
    const home = resolve(config.dshHome.replace(/^~/, process.env.HOME ?? '~'))
    addDir(home, 'global', home)
  }

  return dirs
}
