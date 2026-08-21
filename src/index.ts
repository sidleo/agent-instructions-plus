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
import { apply as applyInjectionPipeline } from './preset.ts'

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
// Hard dependency on the browser HTTP carrier so the GUI config endpoints
// are registered only after webServer is ready (same pattern as skill-scan).
export const inject = ['webServer'] as const

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

  // ── First-install config seed ───────────────────────────────────────
  // The host-plane injection pipeline (mounted below) serves every preset,
  // so no replacement preset is needed. On first activation with no disk
  // config, seed a parents-mode default so the GUI toggle matches reality.
  const persisted = loadPersistedConfig(config.dshHome)
  if (persisted === undefined) {
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

  // ── HTTP RPC surface (formal-host path) ───────────────────────────
  // The web GUI card talks to the host over HTTP JSON endpoints (same
  // mechanism as skill-scan). `harness.handle` is a DYNAMIC-plugin-only
  // builtin and is NOT available to bundle-installed host halves, so the
  // browser half must use fetch() against these routes, never host.call().
  const webServer = ctx.get('webServer') as
    | { register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void }
    | undefined

  /** Drain a JSON request body into a string (lightweight read). */
  async function readBodyLight(req: { on?: (event: 'data' | 'end' | 'error', cb: (chunk?: Buffer) => void) => void }): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on?.('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) })
      req.on?.('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on?.('error', reject)
    })
  }

  /** Helper: JSON response for a route handler. */
  function jsonResponse(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, body: unknown): void {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  function jsonError(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, message: string): void {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: message }))
  }

  if (webServer?.register) {
    // GET /api/instruction-scan/config — current config
    // POST /api/instruction-scan/config — save config
    webServer.register({
      kind: 'exact',
      path: '/api/instruction-scan/config',
      handler: async (req, res) => {
        const method = (req as { method?: string })?.method
        if (method === 'POST') {
          let parsed: unknown
          try {
            parsed = JSON.parse(await readBodyLight(req as { on?: (event: 'data' | 'end' | 'error', cb: (chunk?: Buffer) => void) => void }))
          } catch {
            return jsonError(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, 'invalid JSON body')
          }
          try {
            cfg = normalizeConfig(parsed)
          } catch (error: unknown) {
            return jsonError(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, error instanceof Error ? error.message : String(error))
          }
          persistConfig(cfg)
          console.log('[instruction-scan] host: config saved:', JSON.stringify(cfg))
          return jsonResponse(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, { ok: true, config: JSON.parse(JSON.stringify(cfg)) })
        }
        jsonResponse(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, JSON.parse(JSON.stringify(cfg)))
      },
    })

    // GET /api/instruction-scan/roots — scan root directories for a cwd
    webServer.register({
      kind: 'exact',
      path: '/api/instruction-scan/roots',
      handler: async (req, res) => {
        const cwd = resolveCwdFromHttp(req)
        jsonResponse(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, { cwd, roots: previewRoots(cfg, cwd) })
      },
    })

    // GET /api/instruction-scan/discover — scan and list instruction files
    webServer.register({
      kind: 'exact',
      path: '/api/instruction-scan/discover',
      handler: async (req, res) => {
        const cwd = resolveCwdFromHttp(req)
        const files = discoverInstructionFiles(cfg, cwd, 1_048_576)
        jsonResponse(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, {
          cwd,
          roots: previewRoots(cfg, cwd),
          files: files.map(f => ({
            absolutePath: f.absolutePath,
            displayPath: f.displayPath,
            source: f.source,
            rank: f.rank,
            bytes: Buffer.byteLength(f.content, 'utf8'),
          })),
        })
      },
    })

    // GET /api/instruction-scan/scan-dirs — scan directory model
    webServer.register({
      kind: 'exact',
      path: '/api/instruction-scan/scan-dirs',
      handler: async (req, res) => {
        const cwd = resolveCwdFromHttp(req)
        jsonResponse(res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, {
          cwd,
          dirs: scanDirectories(cfg, cwd).map(d => ({
            dir: d.dir,
            scope: d.scope,
            source: d.source,
            rank: d.rank,
          })),
        })
      },
    })
  } else {
    console.log('[instruction-scan] webServer unavailable — GUI config endpoints disabled')
  }

  /** Resolve cwd from the request query string (?cwd=…), session state, or workspace registry fallback. */
  function resolveCwdFromHttp(req: unknown): string {
    const url = (req as { url?: string })?.url
    if (typeof url === 'string') {
      const match = /[?&]cwd=([^&]+)/.exec(url)
      if (match) {
        try { return decodeURIComponent(match[1]) } catch { /* fall through */ }
      }
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

  // ── Host-plane injection pipeline (all presets) ─────────────────
  // Mount the workspace-instruction injection pipeline at HOST scope: an
  // unscoped `ctx.on` listener is `hook.global`, so it receives `agent/pre-step`
  // for EVERY agent regardless of preset. This makes instruction-scan effective
  // in all modes (standard/liangshen/code/…) without copying or editing any
  // preset. The pipeline replaces built-in agent-instructions messages in the
  // inbox, so there is no duplicate injection.
  applyInjectionPipeline(ctx, cfg)
}
