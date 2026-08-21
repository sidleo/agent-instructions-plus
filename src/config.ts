/**
 * Configuration normalization for instruction-file discovery.
 *
 * @module @sidleo3/instruction-scan/config
 */

const DEFAULT_PROJECT_ROOT_MARKERS = ['.git'] as const
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md'] as const
const RESERVED_PATH_SEGMENTS = new Set(['', '.', '..'])

/** User-facing configuration for instruction-file discovery. */
export interface InstructionScanConfig {
  /** Scan the session working directory (highest priority). */
  readonly scanCwd: boolean
  /** Scan the nearest marker-bearing ancestor (medium, exclusive with scanParents). */
  readonly scanProject: boolean
  /** Walk every ancestor from cwd upward (medium, exclusive with scanProject). */
  readonly scanParents: boolean
  /** Scan the user home (lowest priority). */
  readonly scanGlobal: boolean
  /** Ordered base instruction file candidates; every existing file loads per directory. */
  readonly instructionFileCandidates: readonly string[]
  /** Ordered local-overlay candidates loaded after base files per directory. */
  readonly localInstructionFileCandidates: readonly string[]
  /** Directory entries that identify the project root while walking upward. */
  readonly projectRootMarkers: readonly string[]
  /** Harness home containing the fixed user-global AGENTS.md. */
  readonly dshHome: string
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  readonly maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  readonly maxSourceBytes: number
}

const DEFAULT_MAX_SOURCE_BYTES = 1_048_576

export const DEFAULT_CONFIG: InstructionScanConfig = {
  scanCwd: true,
  scanProject: true,
  scanParents: false,
  scanGlobal: true,
  instructionFileCandidates: [...DEFAULT_INSTRUCTION_FILE_CANDIDATES],
  localInstructionFileCandidates: [...DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES],
  projectRootMarkers: [...DEFAULT_PROJECT_ROOT_MARKERS],
  dshHome: '~/.dsh',
  maxBytes: 65536,
  maxSourceBytes: DEFAULT_MAX_SOURCE_BYTES,
}

/**
 * Normalize + validate a config patch; throws on mutual-exclusivity violation.
 */
export function normalizeConfig(input: unknown): InstructionScanConfig {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const scanProject = src.scanProject !== false
  const scanParents = src.scanParents === true
  if (scanProject && scanParents) throw new Error('scanProject 与 scanParents 互斥，只能开启一项')
  return {
    scanCwd: src.scanCwd !== false,
    scanProject: scanParents ? false : scanProject,
    scanParents,
    scanGlobal: src.scanGlobal !== false,
    instructionFileCandidates: resolveCandidates(src.instructionFileCandidates, DEFAULT_INSTRUCTION_FILE_CANDIDATES),
    localInstructionFileCandidates: resolveCandidates(src.localInstructionFileCandidates, DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES),
    projectRootMarkers: resolveCandidates(src.projectRootMarkers, DEFAULT_PROJECT_ROOT_MARKERS),
    dshHome: typeof src.dshHome === 'string' && src.dshHome.trim().length > 0 ? src.dshHome.trim() : DEFAULT_CONFIG.dshHome,
    maxBytes: typeof src.maxBytes === 'number' && Number.isFinite(src.maxBytes) ? src.maxBytes : DEFAULT_CONFIG.maxBytes,
    maxSourceBytes: typeof src.maxSourceBytes === 'number' && Number.isFinite(src.maxSourceBytes)
      ? src.maxSourceBytes
      : DEFAULT_CONFIG.maxSourceBytes,
  }
}

function resolveCandidates(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  return value
    .filter((v): v is string => typeof v === 'string')
    .filter(v => v.trim().length > 0 && !RESERVED_PATH_SEGMENTS.has(v.trim()) && !/[\\/]/.test(v.trim()))
    .map(v => v.trim())
}
