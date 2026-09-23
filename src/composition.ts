/**
 * Shipped-preset composition reader — @sidleo3/agent-instructions-plus
 *
 * DSH ships each built-in agent preset as a bundle patch file
 * (`@deepseek-ai/dsh-web-app/presets/<id>.patch.yml`), declaring one
 * `@deepseek-ai/dsh-agent-preset` row with a `plugins:` list. Overriding a
 * preset now means replacing that whole list from the profile patch, so the
 * takeover needs the shipped rows verbatim — including their `!!js` custom tags.
 *
 * The roster service (`agentPresets.list()` / `compositionInventory()`) reports
 * evaluated metadata only: it exposes a row's `condition` text but never its
 * `config`, and it evaluates `!!js` expressions. Re-serializing from it would
 * therefore lose configs and rewrite tags. We read the shipped patch FILES as
 * text instead, and hand each plugin row's lines back unchanged.
 *
 * Read-only: nothing here writes. Resolution goes through the preset row's own
 * module base so it works regardless of where the bundle is installed.
 *
 * @module @sidleo3/agent-instructions-plus/composition
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { PresetCompositionRow } from './wizard.ts'

/** The bundle that ships the built-in preset declarations. */
const WEB_APP_PACKAGE = '@deepseek-ai/dsh-web-app'

/**
 * Locate the shipped preset patch directory.
 *
 * Resolution starts from THIS plugin's own location: the plugin is installed
 * inside the profile, so its `node_modules` chain reaches the harness packages
 * that ship the preset declarations. The profile directory is tried as a
 * fallback for installs that hoist the harness elsewhere.
 *
 * @param ctx - host context; `profileContext.dir` supplies the fallback base.
 * @returns the `presets` directory, or undefined when unresolvable.
 */
function presetPatchDirectory(ctx: unknown): string | undefined {
  const profile = (ctx as { get?: (name: string) => unknown } | undefined)?.get?.('profileContext') as
    | { dir?: string }
    | undefined
  const bases = [
    import.meta.url,
    profile?.dir === undefined ? undefined : join(profile.dir, 'package.json'),
  ].filter((value): value is string => typeof value === 'string')
  for (const base of bases) {
    try {
      const require = createRequire(base)
      const manifest = require.resolve(`${WEB_APP_PACKAGE}/package.json`)
      return join(dirname(manifest), 'presets')
    } catch { /* try the next base */ }
  }
  return undefined
}

/** The patch file that declares one shipped preset. */
function presetPatchFile(id: string): string {
  return `${id}.patch.yml`
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
 * Parse the plugin rows out of one shipped preset patch's text.
 *
 * Line-oriented on purpose: the patch carries `!!js` tags that a YAML
 * round-trip would evaluate and rewrite, so only indentation is interpreted
 * here and every scalar is preserved as literal text.
 *
 * @param text - the shipped patch file's contents.
 * @returns the preset's plugin rows in declaration order.
 */
export function parseShippedComposition(text: string): PresetCompositionRow[] {
  const raw = text.split(/\r?\n/)
  // Find the `plugins:` key of the preset declaration, then take its body.
  const startIndex = raw.findIndex(line => /^\s+plugins:\s*$/.test(line))
  if (startIndex < 0) return []
  const keyIndent = /^(\s*)plugins:/.exec(raw[startIndex])?.[1].length ?? 0
  const body: string[] = []
  for (let i = startIndex + 1; i < raw.length; i++) {
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
 * Read every shipped preset's plugin composition.
 *
 * A preset whose patch file is missing or unreadable is simply absent from the
 * map; the caller treats that as "cannot take over" rather than inventing rows.
 *
 * @param ctx - host context providing `profileContext` for module resolution.
 * @returns preset id → plugin rows, in declaration order.
 */
export async function listPresetCompositions(
  ctx: unknown,
): Promise<Map<string, PresetCompositionRow[]>> {
  const out = new Map<string, PresetCompositionRow[]>()
  const directory = presetPatchDirectory(ctx)
  if (directory === undefined) return out
  // The roster's ids are the patch file basenames; read them from the package's
  // own manifest so a preset DSH adds or removes is followed, not guessed.
  let ids: string[]
  try {
    const manifestPath = join(dirname(directory), 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dsh?: { bundle?: { patch?: string | string[] } }
    }
    const patches = manifest.dsh?.bundle?.patch
    const list = Array.isArray(patches) ? patches : patches === undefined ? [] : [patches]
    ids = list
      .filter(entry => entry.includes('/presets/'))
      .map(entry => entry.slice(entry.lastIndexOf('/') + 1).replace(/\.patch\.yml$/, ''))
  } catch {
    return out
  }
  for (const id of ids) {
    try {
      const text = await readFile(join(directory, presetPatchFile(id)), 'utf8')
      out.set(id, parseShippedComposition(text))
    } catch { /* preset without a readable patch */ }
  }
  return out
}
