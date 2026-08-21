# @sidleo3/instruction-scan

Configurable AGENTS.md instruction-file discovery provider for DeepSeek Harness (DSH). Replaces the hardcoded discovery of `dsh-agent-instructions` with four toggleable layers and user-editable candidates/markers.

## Features

- **Four scanning layers**: cwd (highest) → project/parents (mutually exclusive) → global (lowest)
- **scanParents mode**: Walk every ancestor from cwd upward to filesystem root — no depth limit
- **Custom candidates**: Add/remove base instruction file names and local overlay names
- **Custom project-root markers**: Configure which files/dirs identify a project root
- **Web GUI card**: Settings → Plugins → 指令扫描 — configure everything from the browser
- **Provider interface**: Exposes `instructionScanProvider` on context for agent-instructions to consume

## Installation

```bash
# From npm
dsh plugin --profile web add @sidleo3/instruction-scan

# From local checkout
dsh plugin --profile web add link:/path/to/instruction-scan
```

## Configuration

```typescript
interface InstructionScanConfig {
  scanCwd: boolean          // default: true
  scanProject: boolean      // default: true (mutually exclusive with scanParents)
  scanParents: boolean      // default: false (mutually exclusive with scanProject)
  scanGlobal: boolean       // default: true
  instructionFileCandidates: string[]       // default: ['AGENTS.md', 'CLAUDE.md']
  localInstructionFileCandidates: string[]  // default: ['AGENTS.local.md', 'CLAUDE.local.md']
  projectRootMarkers: string[]              // default: ['.git']
  dshHome: string           // default: '~/.dsh'
}
```

## How it works

1. **Discovery**: Scans configured layers for instruction files matching candidates
2. **Provider**: Exposes results via `ctx.instructionScanProvider.list(cwd)`
3. **agent-instructions**: Modified to consume from this provider (falls back to built-in discovery if unavailable)

## Usage

The plugin replaces the *built-in* `dsh-agent-instructions` row inside an agent
preset — **it does not change the `standard` preset itself**. Installation is
fully automatic: the first activation seeds `~/.dsh/dsh-instruction-scan.json`
(parents mode by default) and generates the replacement preset
`~/.dsh/.agent-presets/instruction-scan` (a copy of the current preset with
`agent-instructions` disabled and the injection pipeline inserted). Both steps
are idempotent.

1. Install:
   ```bash
   dsh plugin --profile web add @sidleo3/instruction-scan
   ```
   (From a checkout: `dsh plugin --profile web add link:/path/to/instruction-scan`)
2. Restart DSH (the host half runs the bootstrap on activation).
3. Create a NEW session and pick the **指令扫描模式** preset (not `standard`).
4. Optionally toggle layers from Settings → Plugins → AGENTS扫描; changes
   persist to `~/.dsh/dsh-instruction-scan.json` and the pipeline reads disk
   config on every session start (disk wins over the preset-row config).

> **Gotcha**: `scanProject` and `scanParents` are mutually exclusive. If the UI
> shows `scanParents` checked but instructions from parent dirs still don't
> appear, confirm the session actually uses the 指令扫描模式 preset — the
> `standard` preset always uses the built-in `dsh-agent-instructions`, which
> has no `scanParents` mode and only scans cwd + the nearest `.git`-marked
> project root + global.

## Development

```bash
pnpm build        # tsdown → lib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```
