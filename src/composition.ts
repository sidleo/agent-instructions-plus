/**
 * Preset composition reader — @sidleo3/agent-instructions-plus
 *
 * An agent preset is a declarative `@deepseek-ai/dsh-agent-preset` Loader row
 * carrying a `plugins:` list. Those rows come from ANY bundle layer:
 * DSH ships its built-ins as `@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`,
 * and a user or third party adds their own preset by publishing a bundle whose
 * patch inserts one (e.g. `@local/dsh-yh-standard-preset`). Overriding a preset
 * means replacing that whole list from the profile patch, so the takeover needs
 * the rows verbatim — including their `!!js` custom tags.
 *
 * The roster service (`agentPresets.list()` / `compositionInventory()`) reports
 * evaluated metadata only: it exposes a row's `condition` text but never its
 * `config`, and it evaluates `!!js` expressions. Re-serializing from it would
 * therefore lose configs and rewrite tags. We read the bundle patch FILES as
 * text instead, and hand each plugin row's lines back unchanged.
 *
 * Read-only: nothing here writes. Resolution goes through the plugin's own
 * module base (the profile's `node_modules`), so it finds every bundle the
 * profile has installed.
 *
 * @module @sidleo3/agent-instructions-plus/composition
 */

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import type { PresetCompositionRow } from './wizard.ts'

/** The module name every agent-preset declaration row carries. */
const PRESET_MODULE = '@deepseek-ai/dsh-agent-preset'

/** A resolved bundle layer that may declare presets. */
interface BundleLayer {
  packageName: string
  packageDir: string
  patchFiles: string[]
}

/** Resolution bases, most specific first. */
function resolutionBases(ctx: unknown): string[] {
  const profile = (ctx as { get?: (name: string) => unknown } | undefined)?.get?.('profileContext') as
    | { dir?: string }
    | undefined
  return [
    import.meta.url,
    profile?.dir === undefined ? undefined : join(profile.dir, 'package.json'),
  ].filter((value): value is string => typeof value === 'string')
}

/** The profile's declared bundle list, read from the running profile. */
async function profileBundles(ctx: unknown): Promise<string[]> {
  const profile = (ctx as { get?: (name: string) => unknown } | undefined)?.get?.('profileContext') as
    | { dir?: string }
    | undefined
  if (profile?.dir === undefined) return []
  for (const name of ['package.json']) {
    try {
      const manifest = JSON.parse(await readFile(join(profile.dir, name), 'utf8')) as {
        dsh?: { profile?: { bundles?: unknown } }
      }
      const bundles = manifest.dsh?.profile?.bundles
      if (Array.isArray(bundles)) return bundles.filter((b): b is string => typeof b === 'string')
    } catch { /* fall through */ }
  }
  return []
}

/**
 * Resolve each declared bundle to its patch files.
 *
 * Only bundles that declare `dsh.bundle.patch` can contribute Loader rows, so
 * everything else is skipped without touching the filesystem.
 *
 * @param ctx - host context supplying the profile directory.
 * @returns the resolvable bundle layers, in profile order.
 */
async function bundleLayers(ctx: unknown): Promise<BundleLayer[]> {
  const out: BundleLayer[] = []
  const seen = new Set<string>()
  for (const packageName of await profileBundles(ctx)) {
    if (seen.has(packageName)) continue
    seen.add(packageName)
    for (const base of resolutionBases(ctx)) {
      try {
        const require = createRequire(base)
        const manifestPath = require.resolve(`${packageName}/package.json`)
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
          dsh?: { bundle?: { patch?: unknown } }
        }
        const patch = manifest.dsh?.bundle?.patch
        const list = Array.isArray(patch) ? patch : typeof patch === 'string' ? [patch] : []
        if (list.length === 0) break
        const packageDir = dirname(manifestPath)
        out.push({
          packageName,
          packageDir,
          patchFiles: list
            .filter((p): p is string => typeof p === 'string')
            .map(p => (isAbsolute(p) ? p : join(packageDir, p))),
        })
        break
      } catch { /* bundle not resolvable from this base */ }
    }
  }
  return out
}

/**
 * Split a `plugins:` list body into one entry per plugin row.
 *
 * Rows open at `- id:` and keep every following deeper line (a `config:` block,
 * a nested `group`'s children) with them, so the extracted text is exactly the
 * original YAML — tags, quoting and comments included.
 *
 * @param lines - the lines of the `plugins:` body, dedented to the row level.
 * @returns one line array per plugin row.
 */
function splitPluginRows(lines: string[]): string[][] {
  const rows: string[][] = []
  let current: string[] | undefined
  for (const line of lines) {
    if (/^-\s+id:/.test(line)) {
      if (current !== undefined) rows.push(current)
      current = [line]
    } else if (current !== undefined) {
      current.push(line)
    }
  }
  if (current !== undefined) rows.push(current)
  return rows
}

/**
 * Parse one preset declaration's plugin rows out of a bundle patch's text.
 *
 * Locates the `- id: preset-<id>` (or whatever row id the preset is declared
 * under) whose `name:` is `@deepseek-ai/dsh-agent-preset`, then takes its
 * `config.plugins` body. Matching on the module rather than on a file name is
 * what lets a custom preset bundle be read the same way as a shipped one.
 *
 * Line-oriented on purpose: the patch carries `!!js` tags that a YAML
 * round-trip would evaluate and rewrite, so only indentation is interpreted
 * here and every scalar is preserved as literal text.
 *
 * @param text - one bundle patch file's contents.
 * @param presetId - the preset id to extract.
 * @returns the preset's plugin rows in declaration order, or [] when absent.
 */
export function parsePresetComposition(text: string, presetId: string): PresetCompositionRow[] {
  const raw = text.split(/\r?\n/)
  // Find the declaration carrying this preset id and the preset module.
  let rowIndex = -1
  for (let i = 0; i < raw.length; i++) {
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(raw[i])
    if (idMatch === null) continue
    const indent = idMatch[1].length
    let isPreset = false
    let declaredId: string | undefined
    for (let j = i + 1; j < raw.length; j++) {
      const line = raw[j]
      if (line.trim() === '') continue
      const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0
      if (lineIndent <= indent) break
      if (/^\s*name:\s*['"]?@deepseek-ai\/dsh-agent-preset['"]?\s*$/.test(line)) isPreset = true
      // `config.id` is the authoritative preset id; the row id is only a
      // Loader identifier and a custom bundle may name it differently
      // (e.g. row `preset-yh-standard` declaring preset `yh-standard`).
      const configId = /^\s*id:\s*(.+?)\s*$/.exec(line)
      if (configId !== null) declaredId = unquote(configId[1])
    }
    if (!isPreset) continue
    const byRowId = unquote(idMatch[2])
    if (declaredId === presetId || byRowId === presetId) { rowIndex = i; break }
  }
  if (rowIndex < 0) return []
  const rowIndent = /^(\s*)/.exec(raw[rowIndex])?.[1].length ?? 0

  // Take the `plugins:` body belonging to this row.
  let pluginsIndex = -1
  for (let i = rowIndex + 1; i < raw.length; i++) {
    const line = raw[i]
    if (line.trim() === '') continue
    const indent = /^(\s*)/.exec(line)?.[1].length ?? 0
    if (indent <= rowIndent) break
    if (/^\s*plugins:\s*$/.test(line)) { pluginsIndex = i; break }
  }
  if (pluginsIndex < 0) return []
  const keyIndent = /^(\s*)plugins:/.exec(raw[pluginsIndex])?.[1].length ?? 0
  const body: string[] = []
  for (let i = pluginsIndex + 1; i < raw.length; i++) {
    const line = raw[i]
    if (line.trim() === '') { body.push(line); continue }
    const indent = /^(\s*)/.exec(line)?.[1].length ?? 0
    // The body ends at the first line indented no deeper than the `plugins:` key.
    if (indent <= keyIndent) break
    body.push(line)
  }
  // Dedent the body to column 0 so row detection is a simple prefix test.
  const nonEmpty = body.filter(line => line.trim() !== '')
  const minIndent = nonEmpty.length === 0
    ? 0
    : Math.min(...nonEmpty.map(line => /^(\s*)/.exec(line)?.[1].length ?? 0))
  const dedented = body.map(line => (line.trim() === '' ? '' : line.slice(minIndent)))

  return splitPluginRows(dedented).map((rowLines): PresetCompositionRow => {
    const head = /^-\s+id:\s*(.+?)\s*$/.exec(rowLines[0])
    const id = head === null ? '' : unquote(head[1])
    const nameLine = rowLines.find(line => /^ {2}name:/.test(line))
    const name = nameLine === undefined ? undefined : unquote(nameLine.replace(/^ {2}name:\s*/, '').trim())
    const group = rowLines.some(line => /^ {2}group:\s*true\s*$/.test(line))
    const disabledLine = rowLines.find(line => /^ {2}disabled:/.test(line))
    const disabledText = disabledLine?.replace(/^ {2}disabled:\s*/, '').trim()
    // `!!js …` is preserved as the literal expression; plain `true` is a flag.
    const disabledExpression = disabledText?.startsWith('!!js ')
      ? disabledText.slice('!!js '.length)
      : undefined
    const disabled = disabledExpression === undefined ? disabledText === 'true' : undefined
    const configLine = rowLines.find(line => /^ {2}config:\s*$/.test(line))
    let configText: string[] | undefined
    if (configLine !== undefined) {
      const body = rowLines.slice(rowLines.indexOf(configLine) + 1)
      const nonEmptyConfig = body.filter(line => line.trim() !== '')
      const minConfigIndent = nonEmptyConfig.length === 0
        ? 0
        : Math.min(...nonEmptyConfig.map(line => /^(\s*)/.exec(line)?.[1].length ?? 0))
      // Strip the two extra spaces the row body carries, relative to the config key.
      configText = body.map(line => (line.trim() === '' ? '' : line.slice(minConfigIndent)))
    }
    return { id, name, group, disabled, disabledExpression, configText }
  })
}

/** Strip one layer of matching quotes from a YAML scalar. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/**
 * Read every preset's plugin composition, from every bundle layer.
 *
 * Presets come from DSH's shipped `presets/*.patch.yml` files AND from any
 * third-party or local bundle that inserts its own `@deepseek-ai/dsh-agent-preset`
 * row (a custom preset is exactly that). We therefore walk the profile's bundle
 * list and scan each bundle's patch files.
 *
 * A preset whose declaration cannot be read is simply absent from the map; the
 * caller treats that as "cannot take over" rather than inventing rows.
 *
 * @param ctx - host context providing `profileContext` for module resolution.
 * @returns preset id → plugin rows, in declaration order.
 */
export async function listPresetCompositions(
  ctx: unknown,
): Promise<Map<string, PresetCompositionRow[]>> {
  const out = new Map<string, PresetCompositionRow[]>()
  const layers = await bundleLayers(ctx)
  for (const layer of layers) {
    for (const patchFile of layer.patchFiles) {
      let text: string
      try {
        text = await readFile(patchFile, 'utf8')
      } catch { continue }
      // Every preset id this patch declares, so one file may carry several.
      for (const id of declaredPresetIds(text)) {
        if (out.has(id)) continue
        const rows = parsePresetComposition(text, id)
        if (rows.length > 0) out.set(id, rows)
      }
    }
  }
  return out
}

/**
 * Read each preset's declared display metadata from the bundle patches.
 *
 * `agentPresets.list()` reports the raw id as `name` when the declaration
 * carries no `name` field (all shipped presets), so the patch is the
 * authoritative source for the display text a custom preset declared.
 *
 * @param ctx - host context providing `profileContext` for module resolution.
 * @returns preset id → declared name, description and order (only what is set).
 */
export async function listPresetDeclarations(
  ctx: unknown,
): Promise<Map<string, { name?: string, description?: string, order?: number }>> {
  const out = new Map<string, { name?: string, description?: string, order?: number }>()
  for (const layer of await bundleLayers(ctx)) {
    for (const patchFile of layer.patchFiles) {
      let text: string
      try {
        text = await readFile(patchFile, 'utf8')
      } catch { continue }
      for (const [id, meta] of parseDeclarations(text)) {
        if (!out.has(id)) out.set(id, meta)
      }
    }
  }
  return out
}

/**
 * The display metadata each preset declares in one patch file.
 *
 * Only the declaration's own `config.name` / `config.description` / `config.order`
 * are read — never a plugin row's, so a nested row cannot shadow its preset.
 *
 * @param text - one bundle patch file's contents.
 * @returns preset id → its declared metadata.
 */
function parseDeclarations(
  text: string,
): Map<string, { name?: string, description?: string, order?: number }> {
  const raw = text.split(/\r?\n/)
  const out = new Map<string, { name?: string, description?: string, order?: number }>()
  for (let i = 0; i < raw.length; i++) {
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(raw[i])
    if (idMatch === null) continue
    const indent = idMatch[1].length
    let isPreset = false
    let declaredId: string | undefined
    const meta: { name?: string, description?: string, order?: number } = {}
    for (let j = i + 1; j < raw.length; j++) {
      const line = raw[j]
      if (line.trim() === '') continue
      const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0
      if (lineIndent <= indent) break
      if (/^\s*name:\s*['"]?@deepseek-ai\/dsh-agent-preset['"]?\s*$/.test(line)) { isPreset = true; continue }
      // Stop at the nested `plugins:` list: everything past it belongs to rows.
      if (/^\s*plugins:\s*$/.test(line)) break
      const configId = /^\s*id:\s*(.+?)\s*$/.exec(line)
      if (configId !== null) { declaredId = unquote(configId[1]); continue }
      const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(line)
      if (nameMatch !== null && meta.name === undefined) { meta.name = unquote(nameMatch[1]); continue }
      const descMatch = /^\s*description:\s*(.+?)\s*$/.exec(line)
      if (descMatch !== null && meta.description === undefined) { meta.description = unquote(descMatch[1]); continue }
      const orderMatch = /^\s*order:\s*(\d+)\s*$/.exec(line)
      if (orderMatch !== null && meta.order === undefined) { meta.order = Number(orderMatch[1]) }
    }
    if (isPreset && declaredId !== undefined && !out.has(declaredId)) out.set(declaredId, meta)
  }
  return out
}

/**
 * Every preset id declared in one patch file.
 *
 * Keyed by `config.id` — the authoritative preset id, which is what the roster
 * reports and what a session records. A shipped preset patch declares exactly
 * one; a custom preset bundle may declare several, and its Loader row id may
 * differ from the preset id it declares.
 *
 * @param text - one bundle patch file's contents.
 * @returns the declared preset ids, in file order.
 */
function declaredPresetIds(text: string): string[] {
  const raw = text.split(/\r?\n/)
  const ids: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const idMatch = /^(\s*)-\s+id:\s*(.+?)\s*$/.exec(raw[i])
    if (idMatch === null) continue
    const indent = idMatch[1].length
    let isPreset = false
    let declaredId: string | undefined
    for (let j = i + 1; j < raw.length; j++) {
      const line = raw[j]
      if (line.trim() === '') continue
      const lineIndent = /^(\s*)/.exec(line)?.[1].length ?? 0
      if (lineIndent <= indent) break
      if (/^\s*name:\s*['"]?@deepseek-ai\/dsh-agent-preset['"]?\s*$/.test(line)) isPreset = true
      const configId = /^\s*id:\s*(.+?)\s*$/.exec(line)
      if (configId !== null) declaredId = unquote(configId[1])
    }
    if (isPreset && declaredId !== undefined && !ids.includes(declaredId)) ids.push(declaredId)
  }
  return ids
}
