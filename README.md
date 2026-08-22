# @sidleo3/agent-instructions-plus

按 preset 选择性接管 DSH 的 AGENTS.md 指令注入。以可配置的四层扫描（cwd / 项目 / 上级遍历 / 全局）替代内置 `dsh-agent-instructions` 的固定发现逻辑 —— 但**只在用户显式勾选的 preset 中生效**。

## 核心设计

- **安装零改动**：插件安装后不做任何事，不复制、不修改任何 preset，内置 `agent-instructions` 照常工作
- **用户决定生效范围**：在 Web GUI（Settings → Plugins → AGENTS注入）里勾选要接管的 preset（多选）
- **完全替代**：勾选某个 preset 后，该 preset 被复制为 `agent-instructions-plus-<id>`，副本中内置 `agent-instructions` 行被 `disabled`，由本插件的注入管线接管
- **取消即恢复**：取消勾选删除副本，内置预设原样不动，`agent-instructions` 恢复工作
- **不生效的 preset 不受影响**：未勾选的 preset 完全保持内置行为

## Features

- **Four scanning layers**: cwd (highest) → project/parents (mutually exclusive) → global (lowest)
- **scanParents mode**: Walk every ancestor from cwd upward to filesystem root — no depth limit
- **Custom candidates**: Add/remove base instruction file names and local overlay names
- **Custom project-root markers**: Configure which files/dirs identify a project root
- **Web GUI card**: Settings → Plugins → AGENTS注入 — preset 多选 + 四层扫描配置
- **Provider interface**: Exposes the discovery provider on context for consumers

## Installation

```bash
# From npm
dsh plugin --profile web add @sidleo3/agent-instructions-plus

# From local checkout
dsh plugin --profile web add link:/path/to/agent-instructions-plus
```

安装后重启 DSH。**无需任何额外操作**——插件不会改动任何 preset，内置 agent-instructions 继续工作。

## 使用：在 GUI 中按 preset 启用

1. 打开 Settings → Plugins → **AGENTS注入**
2. 在「生效的预设」列表里勾选要接管的 preset（多选，仅列出含 `agent-instructions` 行的预设）
3. 勾选后立即生效：该 preset 被复制为 `agent-instructions-plus-<id>`（位于 `~/.dsh/.agent-presets/`），副本内 `agent-instructions` 行被禁用，注入管线接管
4. 新会话选择该 preset 时，使用本插件的四层扫描注入 AGENTS.md
5. 取消勾选 = 删除副本，恢复内置 `agent-instructions`（新建会话生效）

> 已运行中的会话不受勾选/取消影响（preset 组合在会话创建时固定）；改动对**之后新建**的会话生效。

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

1. **Install = no-op**：host 入口只注册 provider 与 GUI RPC，不碰任何 preset
2. **User picks presets**：GUI 调 `/api/agent-instructions-plus/presets/apply`，host 用 `ctx.agentPresets.copy()` 复制内置预设 → 副本禁用 `agent-instructions` 行 → 插入 `/preset` 注入管线行
3. **Injection**：副本 preset 中 `/preset` 行的注入管线按四层扫描发现并注入 AGENTS.md，完全替代内置发现
4. **Removal**：GUI 调 `/api/agent-instructions-plus/presets/remove` 删除副本目录，内置预设原样恢复

## Development

```bash
pnpm build        # tsdown → lib/index.js + lib/preset.js + lib/client.js
pnpm typecheck    # tsc --noEmit
```

## Notes

- `provider` 字面值保持 `instruction-scan`，兼容旧 bundle 已持久化的消息；插件标识/路由/包名已全部改为 `agent-instructions-plus`
- 升级 DSH 后，若内置 preset 被覆盖为原版，已生成的副本仍在但可能基于旧内容；在 GUI 里取消再勾选即可基于新版重建
