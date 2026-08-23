/**
 * Session-visible workspace instruction state and dynamic reconciliation.
 *
 * @module @sidleo3/agent-instructions-plus/state
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { FileSystem, FsVersion } from '@deepseek-ai/dsh-fs'
import { join } from 'node:path'
import type { InstructionScanConfig } from './config.ts'
import { instructionContentSha1, trimmedInstructionDigest } from './digest.ts'
import { scanDirectories, scanDisplayBase } from './discovery.ts'
import {
  descendantDirsBetween,
  readCandidateBounded,
  relativeDisplay,
  statCandidate,
  type LoadedInstructionFile,
} from './files.ts'
import {
  candidateScopeKey,
  decodeScopeKey,
  instructionScopeKey,
  renderInstructionChanges,
  USER_GLOBAL_DIRECTORY,
  USER_GLOBAL_FILE,
  type ChangeRenderItem,
  type AgentInstructionChange,
} from './render.ts'

export const name = 'agent-instructions'

/** Durable producer, file, and reconciliation facts for one workspace context. */
export interface AgentInstructionSource {
  kind: 'agent-instructions'
  /** Every workspace context carries instructions read out of a file (the `instructions` context form). */
  form: 'instructions'
  /** Marks the complete startup/resume baseline rather than a later delta. */
  baseline?: true
  /** Marks injection by agent-instructions-plus (as opposed to the built-in provider). */
  provider?: 'instruction-scan'
  /** Discovery, precedence, and budget identity used to validate a resumed baseline. */
  baselineIdentity?: string
  changes: AgentInstructionChange[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-instructions': AgentInstructionSource
  }
}

/** Per-scope metadata cache; instruction prose is deliberately not retained. */
export interface InstructionVersionState {
  path: string
  version: FsVersion
  digest: string
  trimmedDigest: string
}

/** Session-isolated fast-path state keyed by logical instruction scope. */
export type InstructionVersionCache = WeakMap<Session, Map<string, InstructionVersionState>>

/** A metadata-cache transition associated with one rendered instruction change. */
export interface InstructionVersionUpdate {
  change: AgentInstructionChange
  state?: InstructionVersionState
}

/** Rendered reconciliation plus its metadata-cache transitions. */
export interface ReconciledInstructionContext {
  context: UserMessage
  versionUpdates: InstructionVersionUpdate[]
}

function workspaceContextHook(text: string, changes: AgentInstructionChange[]): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'agent-instructions',
      form: 'instructions',
      provider: 'instruction-scan',
      changes,
    },
  })
}

/**
 * Build the user-role message for a rendered baseline.
 * @param text - complete plugin-owned system-reminder text.
 * @returns a user-role prefix message.
 */
export function workspaceContextMessage(text: string): Message {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, provider: 'instruction-scan' },
  })
}

function isWorkspaceContextSource(
  source: unknown,
): source is { kind: 'agent-instructions'; changes: unknown[] } {
  return typeof source === 'object' && source !== null
    && 'kind' in source && source.kind === 'agent-instructions'
    && 'changes' in source && Array.isArray(source.changes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workspaceInstructionChanges(source: { changes: unknown[] }): AgentInstructionChange[] {
  const changes: AgentInstructionChange[] = []
  for (const value of source.changes) {
    if (!isRecord(value)) continue
    if (value.action !== 'set' && value.action !== 'replace' && value.action !== 'remove') continue
    if (typeof value.scope !== 'string' || typeof value.path !== 'string') continue
    if (value.digest !== undefined && typeof value.digest !== 'string') continue
    changes.push({
      action: value.action,
      scope: value.scope,
      path: value.path,
      ...value.digest !== undefined ? { digest: value.digest } : {},
    })
  }
  return changes
}

function sameInstructionChange(a: AgentInstructionChange, b: AgentInstructionChange): boolean {
  return a.action === b.action
    && a.scope === b.scope
    && a.path === b.path
    && a.digest === b.digest
}

function visibleInstructionChanges(
  agent: Agent,
  authorityMessages: readonly UserMessage[],
): Map<string, AgentInstructionChange> {
  const visibleSeqs = new Set(agent.session.surface.nodes)
  const visible = new Map<string, AgentInstructionChange>()
  for (const [seq, event] of agent.session.events.entries()) {
    if (event.type !== 'user/message' || !isWorkspaceContextSource(event.data.source)) continue
    const changes = workspaceInstructionChanges(event.data.source)
    for (const change of changes) {
      if (visibleSeqs.has(seq)) visible.set(change.scope, change)
    }
  }
  for (const message of authorityMessages) {
    if (!isWorkspaceContextSource(message.source)) continue
    for (const change of workspaceInstructionChanges(message.source)) {
      visible.set(change.scope, change)
    }
  }
  return visible
}

/**
 * Convert retained baseline files into comparison and metadata-cache state.
 * @param files - baseline files that survived rendering.
 * @returns latest baseline changes and provider versions keyed by logical scope.
 */
export function baselineInstructionState(files: LoadedInstructionFile[]): {
  changes: Map<string, AgentInstructionChange>
  versions: Map<string, InstructionVersionState>
} {
  const changes = new Map<string, AgentInstructionChange>()
  const versions = new Map<string, InstructionVersionState>()
  for (const file of files) {
    const digest = instructionContentSha1(file.content)
    const change: AgentInstructionChange = {
      action: 'set',
      scope: instructionScopeKey(file.displayPath),
      path: file.displayPath,
      digest,
    }
    changes.set(change.scope, change)
    if (file.version !== undefined) {
      versions.set(change.scope, {
        path: file.displayPath,
        version: file.version,
        digest,
        trimmedDigest: trimmedInstructionDigest(file.content),
      })
    }
  }
  return { changes, versions }
}

function versionStatesFor(session: Session, cache: InstructionVersionCache): Map<string, InstructionVersionState> {
  let states = cache.get(session)
  if (states === undefined) {
    states = new Map()
    cache.set(session, states)
  }
  return states
}

/**
 * Keep only cache updates represented by rendered changes.
 * @param updates - proposed updates from one or more reconciliations.
 * @param renderedChanges - transitions retained by the renderer.
 * @returns updates represented by an exact retained transition.
 */
export function retainedInstructionVersionUpdates(
  updates: readonly InstructionVersionUpdate[],
  renderedChanges: readonly AgentInstructionChange[],
): InstructionVersionUpdate[] {
  return updates.filter(update => renderedChanges.some(change => sameInstructionChange(update.change, change)))
}

/**
 * Apply metadata-cache transitions without retaining instruction prose.
 * @param session - owning session.
 * @param updates - ordered set/delete transitions.
 * @param cache - session-isolated metadata cache.
 */
export function applyInstructionVersionUpdates(
  session: Session,
  updates: readonly InstructionVersionUpdate[],
  cache: InstructionVersionCache,
): void {
  if (updates.length === 0) return
  const states = versionStatesFor(session, cache)
  for (const update of updates) {
    if (update.state === undefined) states.delete(update.change.scope)
    else states.set(update.change.scope, update.state)
  }
  if (states.size === 0) cache.delete(session)
}

/** One scanned directory paired with its candidate scope keys. */
interface DirectoryScopes {
  /** Logical directory scope (`.` or a base-relative path, or `user-global`). */
  scope: string
  /** Absolute directory path. */
  dir: string
  /** Base the display path is relative to. */
  displayBase: string
  /** Candidate file names probed in this directory (base, then local overlays). */
  candidates: string[]
}

/**
 * Build the current configuration's baseline directory set (scan order, highest
 * priority first) with per-directory candidate scope keys.
 * @param config - normalized plugin configuration.
 * @param cwd - absolute session working directory.
 * @returns baseline directories with their candidate name lists.
 */
export function baselineDirectories(config: InstructionScanConfig, cwd: string): DirectoryScopes[] {
  const dirs: DirectoryScopes[] = []
  for (const entry of scanDirectories(config, cwd)) {
    dirs.push({
      scope: entry.scope,
      dir: entry.dir,
      displayBase: entry.displayBase,
      candidates: entry.source === 'global'
        ? [USER_GLOBAL_FILE]
        : [...config.instructionFileCandidates, ...config.localInstructionFileCandidates],
    })
  }
  return dirs
}

/**
 * Compare visible state with provider-visible files and render transitions.
 * @param agent - session owner whose visible surface supplies durable state.
 * @param config - normalized plugin configuration.
 * @param versionCache - per-session scope metadata used to skip unchanged reads.
 * @param fileSystem - provider used for current file probes.
 * @param options - authoritative claimed context, pending scope hints, touched paths, and baseline participation.
 * @returns rendered context plus deferred cache updates, or undefined when unchanged/unavailable.
 */
export async function reconcileInstructionContext(
  agent: Agent,
  config: InstructionScanConfig,
  versionCache: InstructionVersionCache,
  fileSystem: FileSystem,
  options: {
    authorityMessages: readonly UserMessage[]
    scopeMessages: readonly UserMessage[]
    touchedPaths: readonly string[]
    includeBaselineScopes: boolean
    excludedBaselineScopes?: ReadonlySet<string>
    signal?: AbortSignal
  },
): Promise<ReconciledInstructionContext | undefined> {
  const session = agent.session
  const effective = visibleInstructionChanges(agent, options.authorityMessages)
  /* v8 ignore next -- normal agents carry an absolute session cwd. */
  const cwd = session.header.cwd ?? process.cwd()
  const dirs = baselineDirectories(config, cwd)
  const baselineScopes = new Set<string>()
  const dirsByScope = new Map<string, DirectoryScopes>()
  for (const dir of dirs) {
    for (const candidate of dir.candidates) {
      baselineScopes.add(candidateScopeKey(dir.scope, candidate))
    }
    // The first entry for a logical scope wins (scan priority order).
    if (!dirsByScope.has(dir.scope)) dirsByScope.set(dir.scope, dir)
  }

  const scopes = new Set<string>()
  if (options.includeBaselineScopes) {
    for (const scope of baselineScopes) scopes.add(scope)
  }
  for (const message of options.scopeMessages) {
    /* v8 ignore next -- the plugin passes its workspace-only pending projection. */
    if (!isWorkspaceContextSource(message.source)) continue
    for (const change of workspaceInstructionChanges(message.source)) {
      if (!options.includeBaselineScopes && baselineScopes.has(change.scope)) continue
      scopes.add(change.scope)
    }
  }
  for (const scope of effective.keys()) {
    if (!options.includeBaselineScopes && baselineScopes.has(scope)) continue
    const { directory } = decodeScopeKey(scope)
    if (directory === USER_GLOBAL_DIRECTORY) scopes.add(candidateScopeKey(USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE))
    else {
      // The directory may lie outside the baseline set (e.g. a touched nested
      // dir). Synthesize its scope using the current scan base.
      const base = scanDisplayBase(config, cwd)
      const dir = directory === '.' ? base : join(base, directory)
      for (const candidate of [...config.instructionFileCandidates, ...config.localInstructionFileCandidates]) {
        scopes.add(candidateScopeKey(directory, candidate))
      }
      if (!dirsByScope.has(directory)) {
        dirsByScope.set(directory, { scope: directory, dir, displayBase: base, candidates: [...config.instructionFileCandidates, ...config.localInstructionFileCandidates] })
      }
    }
  }
  for (const touchedPath of options.touchedPaths) {
    for (const dir of descendantDirsBetween(cwd, touchedPath)) {
      const base = scanDisplayBase(config, cwd)
      const directory = relativeDisplay(base, dir) || '.'
      for (const candidate of [...config.instructionFileCandidates, ...config.localInstructionFileCandidates]) {
        scopes.add(candidateScopeKey(directory, candidate))
      }
      if (!dirsByScope.has(directory)) {
        dirsByScope.set(directory, { scope: directory, dir, displayBase: base, candidates: [...config.instructionFileCandidates, ...config.localInstructionFileCandidates] })
      }
    }
  }

  const versions = versionStatesFor(session, versionCache)
  const seenAbsolutePaths = new Set<string>()
  const keptTrimmedByDir = new Map<string, Set<string>>()
  const registerKeptTrimmed = (directory: string, digest: string): boolean => {
    let digests = keptTrimmedByDir.get(directory)
    if (digests === undefined) {
      digests = new Set()
      keptTrimmedByDir.set(directory, digests)
    }
    if (digests.has(digest)) return true
    digests.add(digest)
    return false
  }
  const items: ChangeRenderItem[] = []
  const versionUpdates: InstructionVersionUpdate[] = []
  const pushRemoval = (scope: string, path: string): void => {
    const change: AgentInstructionChange = { action: 'remove', scope, path }
    items.push({ change, file: { absolutePath: `removed:${scope}`, displayPath: path, content: '' } })
    versionUpdates.push({ change })
  }

  const scopesByDirectory = new Map<string, string[]>()
  for (const scope of scopes) {
    const { directory } = decodeScopeKey(scope)
    const directoryScopes = scopesByDirectory.get(directory)
    if (directoryScopes === undefined) scopesByDirectory.set(directory, [scope])
    else directoryScopes.push(scope)
  }

  for (const [directory, directoryScopes] of scopesByDirectory) {
    const entry = dirsByScope.get(directory)
    if (entry === undefined) continue
    const probedScopes: string[] = []
    for (const scope of directoryScopes) {
      if (options.excludedBaselineScopes !== undefined
        && baselineScopes.has(scope)
        && options.excludedBaselineScopes.has(scope)) {
        const previous = effective.get(scope)
        if (previous === undefined || previous.action === 'remove') versions.delete(scope)
        else pushRemoval(scope, previous.path)
      } else {
        probedScopes.push(scope)
      }
    }
    const itemStart = items.length
    const versionUpdateStart = versionUpdates.length
    const addedAbsolutePaths: string[] = []
    const priorVersions = new Map(probedScopes.map(scope => [scope, versions.get(scope)]))
    for (const scope of probedScopes) {
      const previous = effective.get(scope)
      const { candidateName } = decodeScopeKey(scope)
      const absolutePath = join(entry.dir, candidateName)
      const probe = await statCandidate(absolutePath, fileSystem, options.signal)
      if (probe.kind === 'unavailable') {
        if (previous === undefined || previous.action === 'remove') continue
        // Same-directory candidates form one deduplicated authority group. If an
        // active member cannot be observed, preserve the entire last-good group.
        items.splice(itemStart)
        versionUpdates.splice(versionUpdateStart)
        for (const [candidateScope, prior] of priorVersions) {
          if (prior === undefined) versions.delete(candidateScope)
          else versions.set(candidateScope, prior)
        }
        for (const absolute of addedAbsolutePaths) seenAbsolutePaths.delete(absolute)
        keptTrimmedByDir.delete(directory)
        break
      }
      if (probe.kind === 'absent') {
        if (previous === undefined || previous.action === 'remove') versions.delete(scope)
        else pushRemoval(scope, previous.path)
        continue
      }
      // A present probe must carry a freshness token to enter the version cache;
      // without one the scope cannot be tracked across passes (not expected in
      // practice since both providers supply versions).
      if (probe.version === undefined) continue
      if (seenAbsolutePaths.has(absolutePath)) continue
      seenAbsolutePaths.add(absolutePath)
      addedAbsolutePaths.push(absolutePath)
      // user-global must use the same display path as the baseline loader
      // (userGlobalDisplayPath -> dshHome/AGENTS.md); a relative path here
      // would never match the baseline's path and every reconcile pass would
      // emit a spurious replace for an unchanged file.
      const displayPath = directory === USER_GLOBAL_DIRECTORY
        ? config.dshHome + '/AGENTS.md'
        : relativeDisplay(entry.displayBase, absolutePath) || candidateName
      const cached = versions.get(scope)
      if (
        cached !== undefined
        && cached.path === displayPath
        && cached.version === probe.version
        && previous !== undefined
        && previous.action !== 'remove'
        && previous.path === cached.path
        && previous.digest === cached.digest
      ) {
        if (registerKeptTrimmed(directory, cached.trimmedDigest)) pushRemoval(scope, previous.path)
        continue
      }

      const content = await readCandidateBounded(
        { absolutePath, ...probe.target === undefined ? {} : { target: probe.target }, ...probe.size === undefined ? {} : { size: probe.size } },
        config.maxSourceBytes,
        fileSystem,
        options.signal,
      )
      if (content === undefined) continue
      const currentDigest = instructionContentSha1(content)
      const trimmedDigest = trimmedInstructionDigest(content)
      if (registerKeptTrimmed(directory, trimmedDigest)) {
        if (previous !== undefined && previous.action !== 'remove') pushRemoval(scope, previous.path)
        else versions.delete(scope)
        continue
      }
      const nextVersion: InstructionVersionState = {
        path: displayPath,
        version: probe.version,
        digest: currentDigest,
        trimmedDigest,
      }
      if (previous !== undefined && previous.action !== 'remove' && previous.path === displayPath && previous.digest === currentDigest) {
        versions.set(scope, nextVersion)
        continue
      }
      const action = previous === undefined || previous.action === 'remove' ? 'set' : 'replace'
      const change: AgentInstructionChange = {
        action,
        scope,
        path: displayPath,
        digest: currentDigest,
      }
      items.push({ change, file: { absolutePath, displayPath, content, ...probe.version === undefined ? {} : { version: probe.version } } })
      versionUpdates.push({ change, state: nextVersion })
    }
  }
  if (items.length === 0) return undefined
  const rendered = renderInstructionChanges(items, config.maxBytes)
  if (rendered.text.length === 0 || rendered.changes.length === 0) return undefined
  return {
    context: workspaceContextHook(rendered.text, rendered.changes),
    versionUpdates: retainedInstructionVersionUpdates(versionUpdates, rendered.changes),
  }
}