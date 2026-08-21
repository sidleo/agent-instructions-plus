/**
 * instruction-scan Host entry — @sidleo3/instruction-scan
 *
 * A configurable instruction-file discovery provider for DeepSeek Harness.
 * Replaces the hardcoded discovery of `dsh-agent-instructions` with four
 * toggleable layers and user-editable candidates/markers.
 * Provides a browser-facing JSON RPC surface (config get/set, roots preview,
 * discovery debug).
 *
 * @module @sidleo3/instruction-scan
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  type InstructionScanConfig,
} from './config.ts'
import {
  discoverInstructionFiles,
  previewRoots,
  scanDirectories,
  type DiscoveredFile,
} from './discovery.ts'
import { wizardReplace, wizardRestore, wizardStatus } from './wizard.ts'

export type { InstructionScanConfig } from './config.ts'
export { normalizeConfig, DEFAULT_CONFIG } from './config.ts'
export { discoverInstructionFiles, previewRoots, scanDirectories, scanDisplayBase, type DiscoveredFile, type ScanDirectory } from './discovery.ts'
export {
  loadBaselineInstructionSet,
  dedupInstructionFilesByDirectory,
  userGlobalDisplayPath,
  type LoadedInstructionFile,
  type RenderedInstructionSet,
} from './files.ts'
export {
  baselineInstructionState,
  reconcileInstructionContext,
  applyInstructionVersionUpdates,
  workspaceContextMessage,
  type InstructionVersionCache,
  type InstructionVersionState,
  type ReconciledInstructionContext,
} from './state.ts'
export { renderWorkspaceContext, renderInstructionChanges, candidateScopeKey, decodeScopeKey, instructionScopeKey, USER_GLOBAL_DIRECTORY, USER_GLOBAL_FILE, type RenderedWorkspaceContext, type AgentInstructionChange } from './render.ts'

export const name = 'instruction-scan'
export const inject = [] as const

// ── Config persistence ──────────────────────────────────────────────

const CONFIG_FILENAME = 'dsh-instruction-scan.json'

function configPath(dshHome: string): string {
  const home = dshHome.replace(/^~/, process.env.HOME ?? '~')
  return join(home, CONFIG_FILENAME)
}

function loadPersistedConfig(dshHome: string): InstructionScanConfig | undefined {
  try {
    const raw = readFileSync(configPath(dshHome), 'utf8')
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function persistConfig(config: InstructionScanConfig): void {
  try {
    const home = config.dshHome.replace(/^~/, process.env.HOME ?? '~')
    writeFileSync(configPath(home), JSON.stringify(config, null, 2), 'utf8')
  } catch { /* best-effort */ }
}

// ── Provider interface ──────────────────────────────────────────────

/** Provider that agent-instructions or other consumers can query. */
export interface InstructionScanProvider {
  name: string
  /** Discover instruction files for a given cwd. */
  list(cwd: string, signal?: AbortSignal): DiscoveredFile[]
  /** Get the current resolved config. */
  getConfig(): InstructionScanConfig
}

// ── Module-level singleton provider ─────────────────────────────────
// Exported so agent-instructions (or any other consumer) can import
// `getInstructionScanProvider()` to access the current provider instance
// without needing Cordis context injection.

let currentProvider: InstructionScanProvider | undefined

/**
 * Get the current instruction-scan provider instance.
 * Returns undefined if the plugin has not yet been applied.
 * Agent-instructions should call this at discovery time to get the
 * latest config and discover files through the provider.
 */
export function getInstructionScanProvider(): InstructionScanProvider | undefined {
  return currentProvider
}

// ── Plugin entry ────────────────────────────────────────────────────

export function apply(ctx: Context, config: InstructionScanConfig = DEFAULT_CONFIG): void {
  // Disk config takes precedence over passed-in config (same as skill-scan).
  let cfg = loadPersistedConfig(config.dshHome) ?? normalizeConfig(config)
  let lastCwd: string | undefined

  // ── Install-time bootstrap ──────────────────────────────────────────
  // Runs once per plugin activation (idempotent): generates the replacement
  // agent preset (copy of the current preset with agent-instructions disabled
  // and the injection pipeline inserted) and seeds the persisted config with
  // scanParents when no disk config exists yet. Users install the plugin and
  // pick the 指令扫描模式 preset in a new session — no manual edits needed.
  void (async () => {
    try {
      const result = await wizardReplace(ctx)
      console.log('[instruction-scan] install bootstrap:', result?.message ?? result?.error ?? 'done')
    } catch (error: unknown) {
      console.log('[instruction-scan] install bootstrap skipped:', error instanceof Error ? error.message : String(error))
    }
  })()
  const persisted = loadPersistedConfig(config.dshHome)
  if (persisted === undefined) {
    // First install: seed a parents-mode default so the toggle in the GUI
    // matches what the replacement preset actually uses.
    const seeded = normalizeConfig({ ...DEFAULT_CONFIG, scanProject: false, scanParents: true })
    persistConfig(seeded)
    cfg = seeded
  }

  // ── Provider ────────────────────────────────────────────────────
  const provider: InstructionScanProvider = {
    name: 'instruction-scan',
    list(cwd: string, signal?: AbortSignal): DiscoveredFile[] {
      signal?.throwIfAborted()
      return discoverInstructionFiles(cfg, cwd, 1_048_576)
    },
    getConfig(): InstructionScanConfig {
      return { ...cfg }
    },
  }

  // Expose as module-level singleton for cross-plugin consumption.
  currentProvider = provider

  // ── RPC surface ─────────────────────────────────────────────────
  const rpc = ctx.get('harness') as { handle?: (m: string, h: (a: unknown) => unknown) => unknown } | undefined
  console.log('[instruction-scan] rpc available:', !!rpc?.handle)
  if (rpc?.handle) {
    rpc.handle('instruction-scan/get-config', () => {
      console.log('[instruction-scan] host: get-config called, cfg:', cfg)
      return JSON.parse(JSON.stringify(cfg))
    })
    rpc.handle('instruction-scan/set-config', (args: unknown) => {
      console.log('[instruction-scan] host: set-config called, args:', args)
      cfg = normalizeConfig(args)
      persistConfig(cfg)
      console.log('[instruction-scan] host: set-config persisted, cfg:', cfg)
      return { ok: true, config: JSON.parse(JSON.stringify(cfg)) }
    })
    rpc.handle('instruction-scan/roots', (args: unknown) => {
      const cwd = resolveCwdFromArgs(args)
      return { cwd, roots: previewRoots(cfg, cwd) }
    })
    rpc.handle('instruction-scan/discover', (args: unknown) => {
      const cwd = resolveCwdFromArgs(args)
      const files = discoverInstructionFiles(cfg, cwd, 1_048_576)
      return {
        cwd,
        roots: previewRoots(cfg, cwd),
        files: files.map(f => ({
          absolutePath: f.absolutePath,
          displayPath: f.displayPath,
          source: f.source,
          rank: f.rank,
          bytes: Buffer.byteLength(f.content, 'utf8'),
        })),
      }
    })
    rpc.handle('instruction-scan/scan-dirs', (args: unknown) => {
      const cwd = resolveCwdFromArgs(args)
      return {
        cwd,
        dirs: scanDirectories(cfg, cwd).map(d => ({
          dir: d.dir,
          scope: d.scope,
          source: d.source,
          rank: d.rank,
        })),
      }
    })
    rpc.handle('instruction-scan/wizard-status', () => wizardStatus(ctx))
    rpc.handle('instruction-scan/wizard-replace', () => wizardReplace(ctx))
    rpc.handle('instruction-scan/wizard-restore', () => wizardRestore(ctx))
  }

  /** Resolve cwd from args, session state, or workspace registry fallback. */
  function resolveCwdFromArgs(args: unknown): string {
    if (args && typeof args === 'object' && typeof (args as Record<string, unknown>).cwd === 'string') {
      return (args as { cwd: string }).cwd
    }
    if (lastCwd) return lastCwd
    // Try workspace registry (available when DSH web GUI is running).
    try {
      const registry = (ctx as unknown as Record<string, unknown>)['workspaceRegistry'] as
        { list?: () => Array<{ path?: string }> } | undefined
      const workspaces = registry?.list?.()
      if (Array.isArray(workspaces) && workspaces.length > 0) {
        const first = workspaces[0]
        if (first && typeof first.path === 'string' && first.path.length > 0) {
          lastCwd = first.path
          return first.path
        }
      }
    } catch { /* registry not available */ }
    return process.cwd()
  }

  // ── Track cwd from session events ───────────────────────────────
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'step/start') {
      // Capture cwd from agent session if available.
      const session = (_session as { header?: { cwd?: string } })
      if (session?.header?.cwd) lastCwd = session.header.cwd
    }
  })
}
