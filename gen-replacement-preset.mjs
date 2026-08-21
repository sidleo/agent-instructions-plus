/**
 * Generate the replacement preset: copy the standard preset to
 * ~/.dsh/.agent-presets/instruction-scan, disable its agent-instructions row,
 * and insert the instruction-scan pipeline row right after it.
 * Mirrors src/wizard.ts (which runs in the formal host during install).
 *
 * Usage: node gen-replacement-preset.mjs [source-preset-path]
 *   source-preset-path defaults to the shipped standard preset under the
 *   DSH deployment checkout; pass an explicit path (e.g. the liangshen copy)
 *   to generate from another preset.
 */
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'

const SRC = process.argv[2] ?? '/Users/zhang3/deepseek-harness/apps/cli/config/agent-presets/standard'
const DST = '/Users/zhang3/.dsh/.agent-presets/instruction-scan'

await mkdir(DST, { recursive: true })
for (const name of await readdir(SRC)) {
  await cp(join(SRC, name), join(DST, name), { recursive: true })
}

const path = join(DST, 'agent.cordis.yml')
const text = await readFile(path, 'utf8')
const doc = parseDocument(text)

const entries = doc.toJS() // plain array of row objects
if (!Array.isArray(entries)) throw new Error('not a sequence: ' + path)
let found = -1
for (let i = 0; i < entries.length; i++) {
  if (entries[i] && typeof entries[i] === 'object' && entries[i].id === 'agent-instructions') {
    entries[i].disabled = true
    found = i
  }
}
if (found < 0) throw new Error('agent-instructions row not found in ' + path)

entries.splice(found + 1, 0, {
  id: 'instruction-scan-pipeline',
  name: '@sidleo3/instruction-scan/preset',
  config: { maxBytes: 65536, maxSourceBytes: 1048576 },
})

// Replace the document contents with the modified plain sequence
const { YAMLSeq } = await import('yaml')
const seq = new YAMLSeq()
for (const entry of entries) seq.add(doc.createNode(entry))
doc.contents = seq
await writeFile(path, doc.toString(), 'utf8')

await writeFile(
  join(DST, 'preset.yml'),
  'name: 指令扫描模式\n' + 'description: standard 编码代理 + instruction-scan 接管工作区指令注入（agent-instructions 已禁用，支持 cwd/项目/上级遍历/全局四层）。\n',
  'utf8',
)

console.log('replacement preset written to', DST)
const lines = (await readFile(path, 'utf8')).split('\n')
const start = Math.max(0, lines.findIndex(l => l.includes('agent-instructions')) - 2)
console.log(lines.slice(start, start + 14).join('\n'))