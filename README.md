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

## Development

```bash
pnpm build        # tsdown → lib/index.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```
