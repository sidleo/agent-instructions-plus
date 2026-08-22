/**
 * agent-instructions-plus preset manager — @sidleo3/agent-instructions-plus
 *
 * Per-preset takeover of workspace-instruction injection. Installation changes
 * nothing: the host entry registers only the provider + GUI RPC. The user
 * explicitly picks presets in the GUI; for each picked preset this module
 * edits the preset's OWN composition in place: the `agent-instructions` row
 * gets `disabled: true` and the `/preset` injection-pipeline row is inserted
 * right after it. Unchecking restores the original file from a backup copy.
 * A DSH upgrade may rewrite the preset file back to pristine; the GUI then
 * shows it as not enabled and re-checking re-applies the takeover.
 *
 * The preset file is backed up to `.aip-backup/<presetId>.yml` next to the
 * roster before editing, so removal restores the exact original bytes.
 *
 * Runs only in the formal host, which holds full `ctx` (`ctx.agentPresets`,
 * `node:fs`, `yaml`).
 *
 * @module @sidleo3/agent-instructions-plus/wizard
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseDocument, YAMLSeq } from 'yaml'

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
 * Enable takeover for one preset by editing its own composition in place:
 * backup the original, disable its agent-instructions row, insert the
 * pipeline row right after it.
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
  // Backup the original bytes (once).
  if (!existing.backupExists) {
    try {
      await mkdir(dirname(backupPath(preset.path)), { recursive: true })
      await writeFile(backupPath(preset.path), text, 'utf8')
    } catch (error) {
      return { ok: false, error: '备份预设失败: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  // Edit the composition.
  const doc = parseDocument(text)
  const js = doc.toJS() as unknown
  const seq = Array.isArray(js) ? js : undefined
  if (seq === undefined) {
    return { ok: false, error: '预设结构无法解析为行序列，停止替换' }
  }
  let index = -1
  let disabled = false
  for (let i = 0; i < seq.length; i++) {
    const row = seq[i]
    if (row && typeof row === 'object' && 'id' in row && (row as { id?: unknown }).id === BUILTIN_ROW_ID) {
      ;(row as Record<string, unknown>).disabled = true
      disabled = true
      index = i
    }
  }
  if (!disabled || index < 0) {
    return { ok: false, error: '未找到 agent-instructions 行，停止替换' }
  }
  const pipelineRow: Record<string, unknown> = {
    id: PIPELINE_ROW_ID,
    name: PIPELINE_PACKAGE,
  }
  pipelineRow.config = { maxBytes: 65536, maxSourceBytes: 1048576 }
  seq.splice(index + 1, 0, pipelineRow)
  const rebuilt = new YAMLSeq<unknown>()
  for (const entry of seq) rebuilt.add(doc.createNode(entry))
  doc.contents = rebuilt as typeof doc.contents
  const edited = doc.toString()
  if ('writeComposition' in ctx) {
    await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, edited)
  } else {
    await writeFile(preset.path, edited, 'utf8')
  }
  return { ok: true, message: '预设 ' + presetId + ' 已生效：agent-instructions 已禁用，注入管线已接管。' }
}

/**
 * Disable takeover for one preset: restore the original composition from
 * backup, or reverse the in-place edit if no backup exists.
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
  if (!existing.pipelineActive && !existing.builtinDisabled && !existing.backupExists) {
    return { ok: true, message: '预设 ' + presetId + ' 未生效，无需取消' }
  }
  // Prefer restoring the exact original bytes from backup.
  if (existing.backupExists) {
    const backup = backupPath(preset.path)
    const original = await readFile(backup, 'utf8').catch(() => undefined)
    if (original !== undefined) {
      if ('writeComposition' in ctx) {
        await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, original)
      } else {
        await writeFile(preset.path, original, 'utf8')
      }
      return { ok: true, message: '预设 ' + presetId + ' 已取消：已恢复原始配置。' }
    }
  }
  // No backup: reverse the in-place edit.
  const text = await ap.read(presetId).catch(() => '')
  const doc = parseDocument(text)
  const js = doc.toJS() as unknown
  const seq = Array.isArray(js) ? js : undefined
  if (seq === undefined) return { ok: false, error: '预设结构无法解析，无法恢复' }
  const kept: unknown[] = []
  for (const row of seq) {
    if (row && typeof row === 'object' && 'id' in row) {
      const id = (row as { id?: unknown }).id
      if (id === PIPELINE_ROW_ID) continue
      if (id === BUILTIN_ROW_ID) delete (row as Record<string, unknown>).disabled
    }
    kept.push(row)
  }
  const rebuilt = new YAMLSeq<unknown>()
  for (const entry of kept) rebuilt.add(doc.createNode(entry))
  doc.contents = rebuilt as typeof doc.contents
  const restored = doc.toString()
  if ('writeComposition' in ctx) {
    await (ctx as { writeComposition(id: string, content: string): Promise<void> }).writeComposition(presetId, restored)
  } else {
    await writeFile(preset.path, restored, 'utf8')
  }
  return { ok: true, message: '预设 ' + presetId + ' 已取消：已反向恢复。' }
}
