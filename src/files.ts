/**
 * Bounded, abort-aware instruction-file probes and reads over an optional
 * `ctx.fs` provider (node-fs fallback mirrors the original agent-instructions
 * behavior). The four-layer directory model lives in `./discovery.ts`; this
 * module offers the per-candidate stat/read primitives the reconciliation
 * pipeline and baseline loading share.
 *
 * @module @sidleo3/instruction-scan/files
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { FileSystem, FsInfo, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import type { InstructionScanConfig } from './config.ts'
import { trimmedInstructionDigest } from './digest.ts'
import { scanDirectories } from './discovery.ts'
import { renderWorkspaceInstructionSet, USER_GLOBAL_FILE, type RenderedWorkspaceContext } from './render.ts'

/** An instruction candidate identified by absolute and display paths. */
export interface InstructionFile {
  absolutePath: string
  displayPath: string
}

/** An instruction file whose UTF-8 content was read successfully. */
export interface LoadedInstructionFile extends InstructionFile {
  content: string
  /** Provider freshness token when the file was loaded through `ctx.fs`. */
  version?: FsVersion
}

/** A scope candidate probed successfully with its provider metadata. */
export interface ProbedInstructionFile extends InstructionFile {
  target: FsTarget
  version: FsVersion
  size?: number
}

/** Tri-state stat probe distinguishing confirmed absence from provider failure. */
export type StatFileProbe =
  | { kind: 'present'; target?: FsTarget; version?: FsVersion; size?: number }
  | { kind: 'absent' }
  | { kind: 'unavailable' }

function signalOptions(signal?: AbortSignal): { signal: AbortSignal } | undefined {
  return signal === undefined ? undefined : { signal }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/** Host-filesystem stat with tri-state classification. */
async function nodeStatFile(path: string, signal?: AbortSignal): Promise<StatFileProbe> {
  try {
    signal?.throwIfAborted()
    // stat (not lstat) follows a final-component symlink so a link to a regular
    // file loads; a broken link surfaces as ENOENT and is treated as absent.
    const info = await stat(path)
    signal?.throwIfAborted()
    if (!info.isFile()) return { kind: 'absent' }
    // Freshness token for the node-fs fallback: mtime+size changes whenever the
    // file content could change.
    return {
      kind: 'present',
      version: `${info.mtimeMs}:${info.size}` as FsVersion,
      size: info.size,
    }
  } catch (error: unknown) {
    signal?.throwIfAborted()
    return isMissingPathError(error) ? { kind: 'absent' } : { kind: 'unavailable' }
  }
}

/** Provider-backed stat with tri-state classification. */
async function fsStatFile(
  path: string,
  fileSystem: FileSystem,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  // resolve() follows a final-component symlink to its target's stable identity;
  // stat then classifies that target. A missing path or non-file target
  // (including a link to a directory) is absent.
  try {
    const target = await fileSystem.resolve(path, signalOptions(signal))
    signal?.throwIfAborted()
    const info = await fileSystem.stat(target, signal)
    signal?.throwIfAborted()
    if (info?.type !== 'file') return { kind: 'absent' }
    return {
      kind: 'present',
      target,
      version: info.version,
      ...info.size === undefined ? {} : { size: info.size },
    }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unavailable' }
  }
}

/**
 * Probe one absolute candidate path through the provider or host filesystem.
 * @param path - absolute candidate path.
 * @param fileSystem - optional provider used instead of host probes.
 * @param signal - cancellation for provider and host probes.
 */
export function statCandidate(
  path: string,
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<StatFileProbe> {
  return fileSystem === undefined ? nodeStatFile(path, signal) : fsStatFile(path, fileSystem, signal)
}

async function existsAsMarker(path: string, fileSystem?: FileSystem, signal?: AbortSignal): Promise<boolean> {
  if (fileSystem !== undefined) {
    try {
      const target = await fileSystem.resolve(path, signalOptions(signal))
      return await fileSystem.stat(target, signal) !== undefined
    } catch {
      signal?.throwIfAborted()
      return false
    }
  }
  try {
    signal?.throwIfAborted()
    await stat(path)
    signal?.throwIfAborted()
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

/**
 * Walk upward to the first directory containing a configured root marker.
 * @param cwd - absolute directory where the walk begins.
 * @param markers - child names that identify a project root.
 * @param fileSystem - optional provider used instead of host filesystem probes.
 * @param signal - cancellation for provider and host probes.
 * @returns the discovered project root, or `cwd` when no marker exists.
 */
export async function findProjectRoot(
  cwd: string,
  markers: readonly string[],
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (await existsAsMarker(join(current, marker), fileSystem, signal)) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * Build the inclusive root-to-cwd directory chain, ordered broadest → most specific.
 */
export function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    /* v8 ignore next -- discovery always supplies cwd or an ancestor root. */
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Find descendant directories crossed between a root and a touched file.
 * @param root - root that bounds nested discovery.
 * @param touchedPath - absolute path or path relative to `root`.
 * @returns descendant directories from shallowest through the touched file's parent.
 */
export function descendantDirsBetween(root: string, touchedPath: string): string[] {
  const resolvedRoot = resolve(root)
  const targetPath = isAbsolute(touchedPath) ? resolve(touchedPath) : resolve(resolvedRoot, touchedPath)
  const targetDir = dirname(targetPath)
  const rel = relative(resolvedRoot, targetDir)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return []
  return ancestorChain(resolvedRoot, targetDir).slice(1)
}

/** Convert an absolute instruction path to its base-relative display form. */
export function relativeDisplay(base: string, path: string): string {
  return relative(base, path)
}

/**
 * Drop later candidates whose trimmed content duplicates an earlier sibling in
 * the same directory. Different directories never collapse even when identical;
 * within one directory the earliest candidate in discovery order is kept.
 */
export function dedupInstructionFilesByDirectory(files: LoadedInstructionFile[]): LoadedInstructionFile[] {
  const keptDigestsByDir = new Map<string, Set<string>>()
  const kept: LoadedInstructionFile[] = []
  for (const file of files) {
    const dir = dirname(file.displayPath)
    let digests = keptDigestsByDir.get(dir)
    if (digests === undefined) {
      digests = new Set()
      keptDigestsByDir.set(dir, digests)
    }
    const digest = trimmedInstructionDigest(file.content)
    if (digests.has(digest)) continue
    digests.add(digest)
    kept.push(file)
  }
  return kept
}

async function* nodeTextChunks(path: string, signal?: AbortSignal): AsyncIterable<string> {
  const stream = createReadStream(path, { encoding: 'utf8', signal })
  for await (const chunk of stream) yield String(chunk)
}

/**
 * Read one candidate under the per-file byte cap.
 * @param file - probed metadata (path and, when provider-backed, target/version).
 * @param maxSourceBytes - maximum UTF-8 bytes accepted from the source.
 * @param fileSystem - optional provider used for the streaming read.
 * @param signal - cancellation for provider streaming.
 * @returns the file content, or undefined when unreadable or over budget.
 */
export async function readCandidateBounded(
  file: { absolutePath: string; target?: FsTarget; size?: number },
  maxSourceBytes: number,
  fileSystem?: FileSystem,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted()
  if (file.size !== undefined && file.size > maxSourceBytes) return undefined
  try {
    const chunks = fileSystem === undefined || file.target === undefined
      ? nodeTextChunks(file.absolutePath, signal)
      : await fileSystem.streamText(file.target, signal)
    const parts: string[] = []
    let bytes = 0
    for await (const chunk of chunks) {
      signal?.throwIfAborted()
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > maxSourceBytes) return undefined
      parts.push(chunk)
    }
    signal?.throwIfAborted()
    return parts.join('')
  } catch {
    signal?.throwIfAborted()
    // A file may disappear or become unreadable after its metadata probe.
    return undefined
  }
}

/** Rendered baseline plus the successfully read and retained files. */
export interface RenderedInstructionSet {
  rendered: RenderedWorkspaceContext
  /** Successfully read candidates before content deduplication and byte budgeting. */
  observed: LoadedInstructionFile[]
  /** Candidates retained by content deduplication and byte budgeting. */
  included: LoadedInstructionFile[]
}

/** Display form for the user-global instruction file. */
export function userGlobalDisplayPath(dshHome: string): string {
  const home = dshHome.replace(/^~/, process.env.HOME ?? '~')
  return `${dshHome}/AGENTS.md`
}

/**
 * Discover, read, and render the baseline instruction chain across the
 * configured four layers, in scan priority order (highest first).
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @param fileSystem - optional provider used instead of host filesystem reads.
 * @param options - cancellation and baseline-replacement flags.
 * @returns rendered baseline and retained files, or undefined when nothing loads.
 */
export async function loadBaselineInstructionSet(
  config: InstructionScanConfig,
  cwd: string,
  fileSystem?: FileSystem,
  options: { signal?: AbortSignal; replacePreviousBaseline?: boolean } = {},
): Promise<RenderedInstructionSet | undefined> {
  if (config.maxBytes <= 0 || !Number.isFinite(config.maxBytes)) return undefined
  if (config.maxSourceBytes <= 0 || !Number.isFinite(config.maxSourceBytes)) return undefined
  const loaded: LoadedInstructionFile[] = []
  const seen = new Set<string>()
  for (const dir of scanDirectories(config, cwd)) {
    const candidates = [...config.instructionFileCandidates, ...config.localInstructionFileCandidates]
    for (const candidate of candidates) {
      const absolutePath = join(dir.dir, candidate)
      if (seen.has(absolutePath)) continue
      const probe = await statCandidate(absolutePath, fileSystem, options.signal)
      if (probe.kind !== 'present') continue
      const content = await readCandidateBounded(
        { absolutePath, ...probe.target === undefined ? {} : { target: probe.target }, ...probe.size === undefined ? {} : { size: probe.size } },
        config.maxSourceBytes,
        fileSystem,
        options.signal,
      )
      if (content === undefined) continue
      seen.add(absolutePath)
      loaded.push({
        absolutePath,
        displayPath: dir.source === 'global'
          ? userGlobalDisplayPath(config.dshHome)
          : relative(dir.displayBase, absolutePath) || candidate,
        content,
        ...probe.version === undefined ? {} : { version: probe.version },
      })
    }
  }
  const deduped = dedupInstructionFilesByDirectory(loaded)
  if (deduped.length === 0) {
    if (options.replacePreviousBaseline !== true) return undefined
    const { rendered, included } = renderWorkspaceInstructionSet([], {
      maxBytes: config.maxBytes,
      replacePreviousBaseline: true,
    })
    return { rendered, observed: [], included }
  }
  const { rendered, included } = renderWorkspaceInstructionSet(deduped, {
    maxBytes: config.maxBytes,
    ...options.replacePreviousBaseline === undefined
      ? {}
      : { replacePreviousBaseline: options.replacePreviousBaseline },
  })
  return { rendered, observed: loaded, included }
}