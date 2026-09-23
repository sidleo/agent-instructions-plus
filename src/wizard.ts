/**
 * agent-instructions-plus preset manager — @sidleo3/agent-instructions-plus
 *
 * Per-preset takeover of workspace-instruction injection.
 *
 * DSH 0.1.7 changed where a preset composition can live. The
 * `agent-presets` directory scan is gone: `@deepseek-ai/dsh-agent-preset-registry`
 * "neither scans directories nor accepts preset paths", and its `list()`/`resolve()`
 * return display metadata only — no composition path, no read, no write. A preset
 * is now a declarative `@deepseek-ai/dsh-agent-preset` Loader row, and overriding a
 * shipped one is a **bundle patch**: an entry in the profile's `cordis.patch.yml`.
 *
 * So takeover writes a `preset-<id>` override row into the profile patch instead of
 * editing a preset file. The override replaces that preset's whole `plugins` list
 * (patch semantics are replace, not merge), copying the shipped rows and swapping
 * the builtin `agent-instructions` row for the `/preset` pipeline row.
 *
 * Editing is LINE-BASED, not parse→re-serialize: both the patch and the copied rows
 * carry `!!js` custom tags (e.g. `disabled: !!js process.platform === 'win32'` on the
 * shell rows). A full parse→re-serialize round-trip evaluates those tags to plain
 * strings, so `disabled` becomes truthy and the shell tools silently disappear. We
 * therefore copy every shipped row as verbatim scalar text and only author the lines
 * we own.
 *
 * Cancelling removes exactly our own row and leaves every other patch entry — other
 * plugins' insert blocks, the managed regions, the user's own overrides — byte-identical.
 * A one-time `.aip-backup/<presetId>.yml` copy of the patch is kept as an audit trail;
 * it is NEVER used to restore, because other plugins write to the same patch.
 *
 * Runs only in the formal host, which holds full `ctx` (`ctx.profileContext`, `node:fs`).
 *
 * @module @sidleo3/agent-instructions-plus/wizard
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'
import { listPresetCompositions, listPresetDeclarations } from './composition.ts'

/** The preset row id the injection pipeline registers under. */
export const PIPELINE_ROW_ID = 'agent-instructions-plus-pipeline'
/** Package subpath the pipeline row loads. */
export const PIPELINE_PACKAGE = '@sidleo3/agent-instructions-plus/preset'
/** Row id of the built-in workspace-instruction provider inside each preset. */
const BUILTIN_ROW_ID = 'agent-instructions'
/** Module name of the declarative preset row we override. */
const PRESET_MODULE = '@deepseek-ai/dsh-agent-preset'

/** Minimal host-context shape for the wizard (profileContext + write hook). */
export interface WizardContext {
  get(name: string): unknown
  /**
   * Optional composition write hook. The real host writes through the resolved
   * profile patch path; tests stub this to avoid touching the filesystem.
   */
  writeComposition?(id: string, content: string): Promise<void>
}

interface AgentPresetInfo {
  id: string
  name?: string
  description?: string
  order?: number
  trust?: string
}

interface AgentPresetsService {
  list(): Promise<AgentPresetInfo[]>
}

function agentPresets(ctx: WizardContext): AgentPresetsService | undefined {
  return ctx.get('agentPresets') as AgentPresetsService | undefined
}

/** The profile's patch document path, or undefined when no managed profile is active. */
function profilePatchPath(ctx: WizardContext): string | undefined {
  const profile = ctx.get('profileContext') as
    | { dir?: string; patchPath?: string }
    | undefined
  if (profile?.patchPath !== undefined) return profile.patchPath
  // Fall back to the conventional location so a profile that predates the
  // `patchPath` field still resolves.
  return profile?.dir === undefined ? undefined : join(profile.dir, 'cordis.patch.yml')
}

/**
 * Backup file path for one preset's takeover.
 *
 * Kept beside the patch the takeover wrote, so the audit trail travels with the
 * profile rather than with a preset directory that no longer exists.
 */
function backupPath(patchPath: string): string {
  return join(dirname(patchPath), '.aip-backup', 'cordis.patch.yml')
}

/** One preset in the roster with its takeover status. */
export interface PresetStatus {
  id: string
  name: string
  description?: string
  trust: string
  /** True when a backup of the patch exists. */
  backupExists: boolean
  /** True when the preset's agent-instructions-plus-pipeline row is present and not disabled. */
  pipelineActive: boolean
  /** True when the preset's built-in agent-instructions row is disabled. */
  builtinDisabled: boolean
  /** True when takeover is fully in effect: pipeline active and builtin disabled. */
  enabled: boolean
  /** True when the preset carries the built-in agent-instructions row to disable. */
  hasAgentInstructions: boolean
}

/** Structured takeover state of one preset, read from the profile patch. */
export interface TakeoverState {
  backupExists: boolean
  pipelineActive: boolean
  builtinDisabled: boolean
  hasAgentInstructions: boolean
}

const EMPTY_STATE: TakeoverState = {
  backupExists: false,
  pipelineActive: false,
  builtinDisabled: false,
  hasAgentInstructions: false,
}

/** The `- id:` value of a top-level patch entry, or undefined when it is an insert block. */
function patchEntryId(row: unknown): string | undefined {
  if (row === null || typeof row !== 'object') return undefined
  const value = (row as { id?: unknown }).id
  return typeof value === 'string' ? value : undefined
}

/** The preset id a `preset-<id>` override targets. */
function targetPresetId(rowId: string): string | undefined {
  const match = /^preset-(.+)$/.exec(rowId)
  return match === null ? undefined : match[1]
}

/**
 * Read the takeover state of one preset from the profile patch.
 *
 * Parsing is read-only here: `!!js` tags resolve to plain strings, which is
 * harmless for inspection and does NOT change the truthiness test — we compare
 * `disabled === true` strictly, so a tag string can never be mistaken for a
 * disabled row.
 */
export async function readTakeoverState(
  ctx: WizardContext,
  presetId: string,
): Promise<TakeoverState> {
  const patchPath = profilePatchPath(ctx)
  if (patchPath === undefined) return EMPTY_STATE
  let backupExists = false
  try {
    await readFile(backupPath(patchPath), 'utf8')
    backupExists = true
  } catch { /* no backup */ }

  let text: string
  try {
    text = await readFile(patchPath, 'utf8')
  } catch {
    return { ...EMPTY_STATE, backupExists }
  }

  let rows: unknown
  try {
    rows = parseDocument(text).toJS()
  } catch {
    return { ...EMPTY_STATE, backupExists }
  }
  if (!Array.isArray(rows)) return { ...EMPTY_STATE, backupExists }

  const override = rows.find(row => patchEntryId(row) === 'preset-' + presetId)
  if (override === undefined || override === null || typeof override !== 'object') {
    return { ...EMPTY_STATE, backupExists }
  }
  const plugins = (override as { config?: { plugins?: unknown } }).config?.plugins
  if (!Array.isArray(plugins)) return { ...EMPTY_STATE, backupExists }

  let pipelineActive = false
  let builtinDisabled = false
  let hasAgentInstructions = false
  for (const plugin of plugins) {
    const id = patchEntryId(plugin)
    if (id === PIPELINE_ROW_ID) {
      pipelineActive = (plugin as { disabled?: unknown }).disabled !== true
    }
    if (id === BUILTIN_ROW_ID) {
      hasAgentInstructions = true
      if ((plugin as { disabled?: unknown }).disabled === true) builtinDisabled = true
    }
  }
  return { backupExists, pipelineActive, builtinDisabled, hasAgentInstructions }
}

/** Current takeover state of every preset. */
export async function listPresets(ctx: WizardContext): Promise<PresetStatus[]> {
  const ap = agentPresets(ctx)
  if (ap === undefined) return []
  const presets = await ap.list()
  const compositions = await listPresetCompositions(ctx)
  const out: PresetStatus[] = []
  for (const p of presets) {
    const composition = compositions.get(p.id)
    // The shipped composition is the authority on whether this preset has a
    // builtin agent-instructions row; the patch only says whether we took over.
    const shippedHasBuiltin = composition?.some(row => row.id === BUILTIN_ROW_ID) ?? false
    const takeover = await readTakeoverState(ctx, p.id)
    out.push({
      id: p.id,
      name: p.name ?? p.id,
      description: p.description,
      trust: p.trust ?? 'shipped',
      backupExists: takeover.backupExists,
      pipelineActive: takeover.pipelineActive,
      builtinDisabled: takeover.builtinDisabled,
      enabled: takeover.pipelineActive && takeover.builtinDisabled,
      hasAgentInstructions: shippedHasBuiltin || takeover.hasAgentInstructions,
    })
  }
  return out
}

/**
 * Line-based patch editor.
 *
 * Rows are split at top-level `- id:` / `- insert:` openers (column 0 only).
 * Nested rows — a preset's `plugins:` entries, an insert block's child rows —
 * are indented and stay inside their parent block, so re-joining never moves
 * them. Untouched blocks are emitted verbatim, byte for byte.
 */

interface RowBlock {
  /** Lines of this row, including its opener (no trailing EOL). */
  lines: string[]
  /** Row-level key: the `id` value, or '' for an insert block / preamble. */
  key: string
}

function splitRows(text: string): RowBlock[] {
  const raw = text.split(/\r?\n/)
  const blocks: RowBlock[] = []
  let current: RowBlock | undefined = { lines: [], key: '' }
  const flush = () => {
    if (current !== undefined && current.lines.length > 0) blocks.push(current)
    current = undefined
  }
  for (const line of raw) {
    // Only column-0 rows open a block. Indented rows (a preset's plugins, an
    // insert block's children) belong to their parent block.
    const opener = /^-\s+id:\s*(['"]?)([^'"]*)\1\s*$/.exec(line)
    const isInsert = /^-\s+insert:\s*$/.test(line)
    if (opener !== null || isInsert) {
      flush()
      current = { lines: [line], key: opener === null ? '' : opener[2] }
    } else if (current !== undefined) {
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

/**
 * Rebuild the text from row blocks, preserving original lines and EOL style.
 *
 * `text.split()` leaves a trailing empty line when the file ends with a newline;
 * the final block therefore owns that empty element, which is the file's
 * terminator rather than a content line. Dropping it here and re-appending the
 * EOL keeps the round-trip byte-identical.
 */
function joinRows(blocks: RowBlock[], eol: '\n' | '\r\n', trailingNewline: boolean): string {
  const lines = blocks.flatMap(block => block.lines)
  if (trailingNewline && lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const body = lines.join(eol)
  return trailingNewline ? body + eol : body
}

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Find the block whose opener matches `rowId`. */
function findRow(blocks: RowBlock[], rowId: string): RowBlock | undefined {
  return blocks.find(block => block.key === rowId)
}

/**
 * Serialize one plugin row of the shipped composition to patch lines, capturing
 * the composition's own scalar text so `!!js` tags and quoting survive verbatim.
 *
 * The rows live under `config:` (4 spaces) → `plugins:` (4) → a row, so a row
 * opener sits at column 6 and the row's own keys two deeper. Each row's captured
 * body is already dedented to column 0 by the composition reader, so it is
 * re-indented relative to its key here.
 */
function pluginRowLines(row: PresetCompositionRow, disabledBuiltin: boolean): string[] {
  const rowIndent = '      '
  const keyIndent = `${rowIndent}  `
  const bodyIndent = `${keyIndent}  `
  const lines = [`${rowIndent}- id: ${row.id}`]
  if (row.name !== undefined) lines.push(`${keyIndent}name: ${JSON.stringify(row.name)}`)
  if (row.group === true) lines.push(`${keyIndent}group: true`)
  // A row's own `!!js` gate is copied verbatim so the platform test keeps
  // working; only the builtin row is forced to a literal `disabled: true`.
  if (row.disabledExpression !== undefined) {
    lines.push(`${keyIndent}disabled: !!js ${row.disabledExpression}`)
  } else if (row.disabled === true || (disabledBuiltin && row.id === BUILTIN_ROW_ID)) {
    lines.push(`${keyIndent}disabled: true`)
  }
  if (row.configText !== undefined) {
    lines.push(`${keyIndent}config:`)
    for (const configLine of row.configText) {
      lines.push(configLine === '' ? '' : `${bodyIndent}${configLine}`)
    }
  }
  return lines
}

/** One row of a shipped preset composition, as captured from the roster. */
export interface PresetCompositionRow {
  id: string
  name?: string
  group?: boolean
  disabled?: boolean
  /** The literal `!!js …` expression text, when the row carried one. */
  disabledExpression?: string
  /** The row's `config:` body, dedented one level; undefined when it had none. */
  configText?: string[]
}

/**
 * Enable takeover for one preset: write a `preset-<id>` override row into the
 * profile patch that copies the shipped composition with the builtin
 * agent-instructions row disabled and the pipeline row appended.
 *
 * Line-based: the new block is authored explicitly and every pre-existing block
 * is emitted verbatim, so `!!js` tags elsewhere in the patch stay intact.
 */
export async function applyPreset(
  ctx: WizardContext,
  presetId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
    return { ok: false, error: '预设 id 非法' }
  }
  const patchPath = profilePatchPath(ctx)
  if (patchPath === undefined) {
    return { ok: false, error: 'profileContext 不可用：无法定位 profile 的 cordis.patch.yml' }
  }
  const ap = agentPresets(ctx)
  if (ap === undefined) return { ok: false, error: 'agentPresets 服务不可用' }

  const presets = await ap.list()
  const preset = presets.find(p => p.id === presetId)
  if (preset === undefined) return { ok: false, error: '预设不存在: ' + presetId }

  const composition = (await listPresetCompositions(ctx)).get(presetId)
  if (composition === undefined || composition.length === 0) {
    return { ok: false, error: '读取预设 ' + presetId + ' 的组合失败，停止接管' }
  }
  if (!composition.some(row => row.id === BUILTIN_ROW_ID)) {
    return { ok: false, error: '预设 ' + presetId + ' 不含 agent-instructions 行，无需接管' }
  }
  // The declaration's own display metadata, so the override preserves the name
  // and description a custom preset bundle declared.
  const declaration = (await listPresetDeclarations(ctx)).get(presetId)

  const existing = await readTakeoverState(ctx, presetId)
  if (existing.pipelineActive && existing.builtinDisabled) {
    return { ok: true, message: '预设 ' + presetId + ' 已生效' }
  }

  let text: string
  try {
    text = await readFile(patchPath, 'utf8')
  } catch {
    text = ''
  }
  // Backup the current patch once, as an audit trail only.
  if (!existing.backupExists && text.length > 0) {
    try {
      await mkdir(dirname(backupPath(patchPath)), { recursive: true })
      await writeFile(backupPath(patchPath), text, 'utf8')
    } catch (error) {
      return { ok: false, error: '备份 profile patch 失败: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  const eol = detectEol(text)
  const trailingNewline = text === '' || text.endsWith('\n')
  const blocks = splitRows(text)
  // Replace a previous, partial override rather than stacking a second one.
  const rowId = 'preset-' + presetId
  const prior = blocks.findIndex(block => block.key === rowId)
  if (prior >= 0) blocks.splice(prior, 1)

  const lines: string[] = [
    `- id: ${rowId}`,
    `  name: ${JSON.stringify(PRESET_MODULE)}`,
    '  config:',
    `    id: ${presetId}`,
  ]
  if (declaration?.order !== undefined) lines.push(`    order: ${declaration.order}`)
  // Carry the preset's own display text through: the roster reports raw ids as
  // `name` for a custom preset, so the patch is the authoritative source.
  if (declaration?.name !== undefined) lines.push(`    name: ${JSON.stringify(declaration.name)}`)
  if (declaration?.description !== undefined) lines.push(`    description: ${JSON.stringify(declaration.description)}`)
  lines.push('    plugins:')
  for (const row of composition) lines.push(...pluginRowLines(row, true))
  // Append the injection pipeline last so it composes after the settings rows.
  lines.push(
    `      - id: ${PIPELINE_ROW_ID}`,
    `        name: ${JSON.stringify(PIPELINE_PACKAGE)}`,
  )

  blocks.push({ lines, key: rowId })
  const edited = joinRows(blocks, eol, trailingNewline)

  try {
    if ('writeComposition' in ctx) {
      await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, edited)
    } else {
      await writeFile(patchPath, edited, 'utf8')
    }
  } catch (error) {
    return { ok: false, error: '写入 profile patch 失败: ' + (error instanceof Error ? error.message : String(error)) }
  }
  return {
    ok: true,
    message: '预设 ' + presetId + ' 已接管：agent-instructions 已禁用，注入管线已接管。重启 DSH 或该预设重建后对新建会话生效。',
  }
}

/**
 * Disable takeover for one preset: remove exactly our own `preset-<id>` override
 * row. Every other patch entry — other plugins' inserts, managed regions, the
 * user's overrides — is emitted byte-identical.
 *
 * The `.aip-backup` copy is never used to restore, because a whole-file restore
 * would silently wipe other plugins' edits to the same patch.
 */
export async function removePreset(
  ctx: WizardContext,
  presetId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const patchPath = profilePatchPath(ctx)
  if (patchPath === undefined) {
    return { ok: false, error: 'profileContext 不可用：无法定位 profile 的 cordis.patch.yml' }
  }
  const existing = await readTakeoverState(ctx, presetId)
  if (!existing.pipelineActive && !existing.builtinDisabled) {
    return { ok: true, message: '预设 ' + presetId + ' 未接管，无需取消' }
  }

  let text: string
  try {
    text = await readFile(patchPath, 'utf8')
  } catch (error) {
    return { ok: false, error: '读取 profile patch 失败: ' + (error instanceof Error ? error.message : String(error)) }
  }

  const rowId = 'preset-' + presetId
  const eol = detectEol(text)
  const trailingNewline = text.endsWith('\n')
  const blocks = splitRows(text)
  const index = blocks.findIndex(block => block.key === rowId)
  if (index < 0) {
    return { ok: true, message: '预设 ' + presetId + ' 未接管，无需取消' }
  }
  blocks.splice(index, 1)
  const restored = joinRows(blocks, eol, trailingNewline)

  try {
    if ('writeComposition' in ctx) {
      await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, restored)
    } else {
      await writeFile(patchPath, restored, 'utf8')
    }
  } catch (error) {
    return { ok: false, error: '写入 profile patch 失败: ' + (error instanceof Error ? error.message : String(error)) }
  }
  return { ok: true, message: '预设 ' + presetId + ' 已取消接管：接管行已移除，其余配置保持不变。' }
}

// Re-exported so the host entry can surface the targeted preset id of a row.
export { targetPresetId }

/** Row ids this module owns in the profile patch. */
export function ownedPatchRowId(presetId: string): string {
  return 'preset-' + presetId
}
