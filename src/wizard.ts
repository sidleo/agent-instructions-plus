/**
 * agent-instructions-plus preset manager — @sidleo3/agent-instructions-plus
 *
 * Per-preset takeover of workspace-instruction injection. Installation changes
 * nothing: the host entry registers only the provider + GUI RPC. The user
 * explicitly picks presets in the GUI; for each picked preset this module
 * edits the preset's OWN composition in place: the `agent-instructions` row
 * gets `disabled: true` and the `/preset` injection-pipeline row is inserted
 * right after it. Unchecking reverses the in-place edit (removes our own
 * pipeline row and the `disabled` marker) WITHOUT touching any other row, so
 * other plugins' takeovers of the same preset survive.
 *
 * Editing is LINE-BASED, not parse→re-serialize: the preset composition uses
 * `!!js` custom YAML tags (e.g. `disabled: !!js process.platform === 'win32'`
 * on the shell rows), which a full parse→re-serialize round-trip would
 * evaluate to plain strings and silently break. We therefore only touch the
 * exact lines we own and leave every other line byte-identical.
 *
 * A one-time `.aip-backup/<presetId>.yml` copy is still kept next to the
 * roster as an audit trail; it is NOT used to restore whole files, because a
 * later restore would wipe other plugins' edits to the same preset.
 *
 * Runs only in the formal host, which holds full `ctx` (`ctx.agentPresets`,
 * `node:fs`, `yaml`).
 *
 * @module @sidleo3/agent-instructions-plus/wizard
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument } from 'yaml'

/** The preset row id the injection pipeline registers under. */
export const PIPELINE_ROW_ID = 'agent-instructions-plus-pipeline'
/** Package subpath the pipeline row loads. */
export const PIPELINE_PACKAGE = '@sidleo3/agent-instructions-plus/preset'
/** Row id of the built-in workspace-instruction provider inside each preset. */
const BUILTIN_ROW_ID = 'agent-instructions'

/** Minimal host-context shape for the wizard (agentPresets + write hook). */
export interface WizardContext {
  get(name: string): unknown
  /**
   * Optional composition write hook. The real host writes through the resolved
   * preset path; tests stub this to avoid touching the filesystem.
   */
  writeComposition?(id: string, content: string): Promise<void>
}

interface AgentPresetInfo {
  id: string
  name?: string
  description?: string
  trust?: string
}

interface AgentPresetsService {
  list(): Promise<AgentPresetInfo[]>
  resolve(id?: string): Promise<AgentPresetInfo & { path: string }>
  read(id: string): Promise<string>
}

function agentPresets(ctx: WizardContext): AgentPresetsService | undefined {
  return ctx.get('agentPresets') as AgentPresetsService | undefined
}

/** Backup file path for one preset's original composition. */
function backupPath(presetPath: string): string {
  return join(dirname(presetPath), '.aip-backup', basename(presetPath))
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/** One preset in the roster with its takeover status. */
export interface PresetStatus {
  id: string
  name: string
  description?: string
  trust: string
  /** True when a backup of the original composition exists. */
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

/** Structured takeover state of one preset, read from its own composition. */
export interface TakeoverState {
  backupExists: boolean
  pipelineActive: boolean
  builtinDisabled: boolean
}

/**
 * Read the takeover state of one preset from its own composition's content.
 */
export async function readTakeoverState(
  ctx: WizardContext,
  presetId: string,
): Promise<TakeoverState> {
  const ap = agentPresets(ctx)
  if (ap === undefined) return { backupExists: false, pipelineActive: false, builtinDisabled: false }
  let preset: AgentPresetInfo & { path: string }
  try {
    preset = await ap.resolve(presetId)
  } catch {
    return { backupExists: false, pipelineActive: false, builtinDisabled: false }
  }
  let backupExists = false
  try {
    await readFile(backupPath(preset.path), 'utf8')
    backupExists = true
  } catch { /* no backup */ }
  let text: string
  try {
    text = await ap.read(presetId)
  } catch {
    return { backupExists, pipelineActive: false, builtinDisabled: false }
  }
  let pipelineActive = false
  let builtinDisabled = false
  try {
    const doc = parseDocument(text)
    const rows = doc.toJS() as unknown
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === 'object' && 'id' in row) {
          const id = (row as { id?: unknown }).id
          const disabled = (row as { disabled?: unknown }).disabled === true
          if (id === PIPELINE_ROW_ID) pipelineActive = !disabled
          if (id === BUILTIN_ROW_ID && disabled) builtinDisabled = true
        }
      }
    }
  } catch { /* unparsable counts as not active */ }
  return { backupExists, pipelineActive, builtinDisabled }
}

/** Current takeover state of every preset. */
export async function listPresets(ctx: WizardContext): Promise<PresetStatus[]> {
  const ap = agentPresets(ctx)
  if (ap === undefined) return []
  const presets = await ap.list()
  const out: PresetStatus[] = []
  for (const p of presets) {
    let hasAgentInstructions = false
    try {
      const text = await ap.read(p.id)
      hasAgentInstructions = /(?:^|[\s-])id:\s*['"]?agent-instructions['"]?\s*$/m.test(text)
    } catch { /* keep false */ }
    const takeover = await readTakeoverState(ctx, p.id)
    out.push({
      id: p.id,
      name: p.name ?? p.id,
      description: p.description,
      trust: p.trust ?? 'user',
      backupExists: takeover.backupExists,
      pipelineActive: takeover.pipelineActive,
      builtinDisabled: takeover.builtinDisabled,
      enabled: takeover.pipelineActive && takeover.builtinDisabled,
      hasAgentInstructions,
    })
  }
  return out
}

/**
 * Line-based composition editor.
 *
 * The preset composition uses `!!js` custom tags (e.g. the shell rows'
 * `disabled: !!js process.platform === 'win32'`). A full parse→re-serialize
 * round-trip evaluates those tags to plain strings and silently breaks the
 * row, so takeover must edit TEXT LINES, not the parsed object model.
 *
 * Rows are split at top-level `- id:` markers (column 0 only). Each row
 * keeps its original lines verbatim; editing only inserts or removes whole
 * lines so untouched rows stay byte-identical.
 */

interface RowBlock {
  /** Lines of this row, including the `- id:` opener (no trailing EOL). */
  lines: string[]
  /** Row-level key: the id value ('' when the line is not a row opener). */
  key: string
}

function splitRows(text: string): RowBlock[] {
  const raw = text.split(/\r?\n/)
  const blocks: RowBlock[] = []
  let current: RowBlock | undefined
  const flush = () => {
    if (current !== undefined) blocks.push(current)
    current = undefined
  }
  for (const line of raw) {
    // Only top-level rows open a block: `- id:` at column 0. Rows nested
    // inside a group's `config:` are indented and must stay inside their
    // parent block, or re-joining would corrupt the composition.
    const opener = /^- id:\s*(['"]?)([^'"]*)\1\s*$/.exec(line)
    if (opener !== null) {
      flush()
      current = { lines: [line], key: opener[2] }
    } else if (current !== undefined) {
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

/** Rebuild the text from row blocks, preserving original lines and EOL style. */
function joinRows(blocks: RowBlock[], eol: '\n' | '\r\n'): string {
  return blocks.flatMap(block => block.lines).join(eol) + (blocks.length > 0 ? eol : '')
}

function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** Find the block whose `- id:` opener matches `rowId`. */
function findRow(blocks: RowBlock[], rowId: string): RowBlock | undefined {
  return blocks.find(block => block.key === rowId)
}

/** Insert a `disabled: true` line into a row right after its `name:` line. */
function setRowDisabled(block: RowBlock, disabled: boolean): void {
  const nameIndex = block.lines.findIndex(line => /^\s*name:/.test(line))
  const target = block.lines.findIndex(line => /^\s*disabled:/.test(line))
  if (disabled) {
    if (target >= 0) {
      block.lines[target] = block.lines[target].replace(/^\s*disabled:.*$/, '  disabled: true')
    } else if (nameIndex >= 0) {
      block.lines.splice(nameIndex + 1, 0, '  disabled: true')
    }
  } else if (target >= 0) {
    block.lines.splice(target, 1)
  }
}

/**
 * Insert a new row right after an existing row's block. The inserted lines
 * are authored explicitly (never round-tripped through the YAML parser), so
 * no tag or quoting is lost.
 */
function insertRowAfter(blocks: RowBlock[], afterKey: string, newBlock: RowBlock): void {
  const index = blocks.findIndex(block => block.key === afterKey)
  if (index < 0) throw new Error('目标行不存在: ' + afterKey)
  blocks.splice(index + 1, 0, newBlock)
}

/** The pipeline row to insert during takeover, authored as literal lines. */
function pipelineRowLines(): string[] {
  return [
    `- id: ${PIPELINE_ROW_ID}`,
    `  name: ${JSON.stringify(PIPELINE_PACKAGE)}`,
    '  config:',
    '    maxBytes: 65536',
    '    maxSourceBytes: 1048576',
  ]
}

/**
 * Enable takeover for one preset by editing its own composition in place:
 * backup the original (audit trail only), disable its agent-instructions row,
 * insert the pipeline row right after it. Line-based: only the touched row
 * and the inserted row change; every other line stays byte-identical.
 */
export async function applyPreset(
  ctx: WizardContext,
  presetId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const ap = agentPresets(ctx)
  if (ap === undefined) return { ok: false, error: 'agentPresets 服务不可用' }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
    return { ok: false, error: '预设 id 非法' }
  }
  let preset: AgentPresetInfo & { path: string }
  try {
    preset = await ap.resolve(presetId)
  } catch {
    return { ok: false, error: '预设不存在: ' + presetId }
  }
  const text = await ap.read(presetId).catch(() => '')
  const hasBuiltin = /(?:^|[\s-])id:\s*['"]?agent-instructions['"]?\s*$/m.test(text)
  if (!hasBuiltin) {
    return { ok: false, error: '预设 ' + presetId + ' 不含 agent-instructions 行，无需接管' }
  }
  // Idempotent: already taken over.
  const existing = await readTakeoverState(ctx, presetId)
  if (existing.pipelineActive && existing.builtinDisabled) {
    return { ok: true, message: '预设 ' + presetId + ' 已生效' }
  }
  // Backup the original bytes (once), as an audit trail only.
  if (!existing.backupExists) {
    try {
      await mkdir(dirname(backupPath(preset.path)), { recursive: true })
      await writeFile(backupPath(preset.path), text, 'utf8')
    } catch (error) {
      return { ok: false, error: '备份预设失败: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  // Edit the composition line-by-line.
  const eol = detectEol(text)
  const blocks = splitRows(text)
  const builtin = findRow(blocks, BUILTIN_ROW_ID)
  if (builtin === undefined) {
    return { ok: false, error: '未找到 agent-instructions 行，停止替换' }
  }
  // Skip adding the pipeline row again if a leftover copy already exists.
  const pipeline = findRow(blocks, PIPELINE_ROW_ID)
  if (pipeline === undefined) {
    insertRowAfter(blocks, BUILTIN_ROW_ID, { lines: pipelineRowLines(), key: PIPELINE_ROW_ID })
  }
  // Disable the builtin row if it is not already disabled.
  const alreadyDisabled = builtin.lines.some(line => /^\s*disabled:\s*true\s*$/.test(line))
  if (!alreadyDisabled) setRowDisabled(builtin, true)
  const edited = joinRows(blocks, eol)
  if ('writeComposition' in ctx) {
    await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, edited)
  } else {
    await writeFile(preset.path, edited, 'utf8')
  }
  return { ok: true, message: '预设 ' + presetId + ' 已生效：agent-instructions 已禁用，注入管线已接管。' }
}

/**
 * Disable takeover for one preset: reverse the in-place edit — remove our
 * own pipeline row and the `disabled` marker on the builtin row — WITHOUT
 * touching any other row. The `.aip-backup` copy is never used to restore
 * whole files, because a full restore would silently wipe other plugins'
 * takeovers of the same preset file.
 */
export async function removePreset(
  ctx: WizardContext,
  presetId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const ap = agentPresets(ctx)
  if (ap === undefined) return { ok: false, error: 'agentPresets 服务不可用' }
  let preset: AgentPresetInfo & { path: string }
  try {
    preset = await ap.resolve(presetId)
  } catch {
    return { ok: false, error: '预设不存在: ' + presetId }
  }
  const existing = await readTakeoverState(ctx, presetId)
  if (!existing.pipelineActive && !existing.builtinDisabled) {
    return { ok: true, message: '预设 ' + presetId + ' 未生效，无需取消' }
  }
  const text = await ap.read(presetId).catch(() => '')
  const eol = detectEol(text)
  const blocks = splitRows(text)
  // Remove our pipeline row, if present.
  const pipelineIndex = blocks.findIndex(block => block.key === PIPELINE_ROW_ID)
  if (pipelineIndex >= 0) blocks.splice(pipelineIndex, 1)
  // Re-enable the builtin row by dropping the disabled line we added.
  const builtin = findRow(blocks, BUILTIN_ROW_ID)
  if (builtin !== undefined && builtin.lines.some(line => /^\s*disabled:/.test(line))) {
    setRowDisabled(builtin, false)
  }
  const restored = joinRows(blocks, eol)
  if ('writeComposition' in ctx) {
    await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, restored)
  } else {
    await writeFile(preset.path, restored, 'utf8')
  }
  return { ok: true, message: '预设 ' + presetId + ' 已取消：已移除接管行，其余配置保持不变。' }
}
