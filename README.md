# @sidleo3/agent-instructions-plus

按 preset 选择性接管 DSH 的 AGENTS.md 指令注入。以可配置的四层扫描（cwd / 项目 / 上级遍历 / 全局）替代内置 `dsh-agent-instructions` 的固定发现逻辑 —— 但**只在用户显式勾选的 preset 中生效**。

## 核心设计

- **安装零改动**：插件安装后不做任何事，不写任何 preset 覆盖，内置 `agent-instructions` 照常工作
- **用户决定生效范围**：在 Web GUI（侧边栏 Plugins → 本插件配置页）里勾选要接管的 preset（多选）
- **完全替代**：勾选某个 preset 后，向该 profile 的 `cordis.patch.yml` 写入 `preset-<id>` 覆盖行 —— 内置 `agent-instructions` 行被 `disabled: true`，并追加本插件的注入管线行
- **取消即恢复**：取消勾选**行级**移除自己那段覆盖行，其他插件的 patch 段逐字节不变，`agent-instructions` 恢复工作
- **不生效的 preset 不受影响**：未勾选的 preset 完全保持内置行为

## 与内置 `agent-instructions` 的区别

两者**运行时骨架同源**：同一套「首个 pre-step 合成 baseline → `tools/result` 的 read/write/edit 冒泡 touches → 增量 reconcile → digest 去重」机制，配置字段也基本一一对应。真正的分歧只有一处 —— **向上扫描在哪里停**。

| 维度 | `agent-instructions`（内置） | `agent-instructions-plus`（本插件） |
|---|---|---|
| **生效范围** | 所有 preset 无条件生效 | **仅用户勾选的 preset**，其余完全保持内置行为 |
| **向上扫描** | 只到 project root（`.git` 标记的祖先）为止 | `scanProject`（同内置）**或** `scanParents`（一路到 `/`），二选一 |
| cwd 自身 | 含在 root→cwd 链里 | `scanCwd` 独立开关 |
| 全局层 | `$DSH_HOME/AGENTS.md` 固定加载 | `scanGlobal` 独立开关 |
| 候选文件名 / 项目根标记 / 字节预算 | `instructionFileCandidates`、`localInstructionFileCandidates`、`projectRootMarkers`、`maxBytes`、`maxSourceBytes` | **同名同义** |
| 刷新触发 / 去重 / baseline 身份 | `tools/result` → 增量 reconcile；SHA-1 digest + 逐目录去重 | 同机制（管线是对内置语义的复刻） |
| 配置入口 | preset 行的 `config` | Web GUI 配置页（写 `cordis.patch.yml` 覆盖行） |

### scanParents 解决什么

设仓库在 `/Users/me/Project/repo`，而 `/Users/me/AGENTS.md` 也写了规则：

- **内置**：在 `repo/.git` 找到项目根就停 → **`/Users/me/AGENTS.md` 读不到**
- **`scanParents`**：一路扫到 `/` → 每一层的 `AGENTS.md` 都能读到

内置的取舍是有意为之：root 探测只在确认标记缺失时才继续向上，遇到权限/IO 错误会**停止并报错**，而不是改选另一个祖先当根 —— 避免把 `/` 或 `$HOME` 误判成项目根、注入无关内容。本插件只是把这个选择权交给你（详见 `@deepseek-ai/dsh-agent-instructions` 的 README「Root discovery」段）。

### 什么时候不需要本插件

如果只想要**改候选名或 `maxBytes`**，内置的 `config` 已经支持，直接写 preset 行即可 —— 不必引入本插件：

```yaml
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536
    instructionFileCandidates: [AGENTS.md, CLAUDE.md, CODEBUDDY.md]
```

**只有需要 `scanParents`（跨 git 仓库向上读）或 `scanCwd` / `scanGlobal` 的独立开关时，本插件才不可替代。**

> ⚠️ 代价：本插件的注入管线是对内置语义的**复刻而非复用**。DSH 修改内置机制时本插件不会自动跟上，需要人工同步（参见 `AGENTS.md` 坑点 7/8/9 —— 那两个真 bug 就是复刻漂移的结果）。

## Features

- **Four scanning layers**: cwd (highest) → project/parents (mutually exclusive) → global (lowest)
- **scanParents mode**: Walk every ancestor from cwd upward to filesystem root — no depth limit
- **Custom candidates**: Add/remove base instruction file names and local overlay names
- **Custom project-root markers**: Configure which files/dirs identify a project root
- **Web GUI page**: 侧边栏 Plugins → 本插件 → 配置页（preset 多选 + 四层扫描配置）
- **Provider interface**: Exposes the discovery provider on context for consumers

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| `0.1.7-alpha.2` 及以后 | ✅ 支持（配置页在侧边栏 Plugins；接管写 profile patch） |
| `0.1.6` 及更早 | ❌ 不支持 —— 旧版的 `settings.plugin.item` 槽位与 `~/.dsh/.agent-presets/` 文件式 preset 在 0.1.7 已被移除 |

## Installation

```bash
# From npm
dsh plugin --profile web add @sidleo3/agent-instructions-plus

# From local checkout
dsh plugin --profile web add link:/path/to/agent-instructions-plus
```

安装后重启 DSH。**无需任何额外操作**——插件不会改动任何 preset，内置 agent-instructions 继续工作。

## 使用：在 GUI 中按 preset 启用

1. 打开**侧边栏 Plugins** → 找到本插件的卡片 → 进入其配置页
2. 在「生效的预设」列表里勾选要接管的 preset（多选，仅列出含 `agent-instructions` 行的内置预设）
3. 勾选后立即写入该 profile 的 `cordis.patch.yml`：新增 `- id: preset-<id>` 覆盖行，其中内置 `agent-instructions` 行被 `disabled: true`，并追加本插件的注入管线行
4. 新会话选择该 preset 时，使用本插件的四层扫描注入 AGENTS.md
5. 取消勾选 = 移除该覆盖行，其余配置逐字节不变（新建会话生效）

> 已运行中的会话不受勾选/取消影响（preset 组合在会话创建时固定）；改动对**之后新建**的会话生效，通常需重启 DSH 让 profile patch 重新合成。

## Configuration

```typescript
interface InstructionScanConfig {
  scanCwd: boolean          // default: true
  scanProject: boolean      // default: false (mutually exclusive with scanParents)
  scanParents: boolean      // default: true (mutually exclusive with scanProject)
  scanGlobal: boolean       // default: true
  instructionFileCandidates: string[]       // default: ['AGENTS.md', 'CLAUDE.md']
  localInstructionFileCandidates: string[]  // default: ['AGENTS.local.md', 'CLAUDE.local.md']
  projectRootMarkers: string[]              // default: ['.git']
  dshHome: string           // default: '~/.dsh'
}
```

配置页遵循 DSH 的页面契约：**编辑只停留在本地草稿，点「保存」才写入**；离开页面丢弃草稿。

## How it works

1. **Install = no-op**：host 入口只注册 provider 与 GUI RPC，不碰任何 preset
2. **User picks presets**：GUI 调 `/api/agent-instructions-plus/presets/apply`，host 在 profile 的 `cordis.patch.yml` 追加 `preset-<id>` 覆盖行 —— 复制该预设的 shipped 组合、把内置 `agent-instructions` 行改为 `disabled: true`、追加 `/preset` 注入管线行
3. **Injection**：被覆盖的 preset 中 `/preset` 行按四层扫描发现并注入 AGENTS.md，完全替代内置发现
4. **Removal**：GUI 调 `/api/agent-instructions-plus/presets/remove` **行级**移除自己那段覆盖行，其他插件的 patch 段逐字节不变

### 为什么写 profile patch 而不是 preset 文件

DSH 0.1.7 起，`@deepseek-ai/dsh-agent-preset-registry` **不再扫描 `~/.dsh/.agent-presets/` 目录，也不接受 preset 路径**：preset 现在是声明式的 `@deepseek-ai/dsh-agent-preset` Loader 行，覆盖已发布的 preset 只能通过 bundle patch。`agentPresets.list()`/`resolve()` 也只返回展示元数据，没有组合路径、没有读/写组合的能力。因此旧版「复制 preset 目录再改文件」的模型已无落点。

## Development

```bash
pnpm install --ignore-scripts   # 无特殊 flag
pnpm build                      # tsdown → lib/index.js + lib/preset.js + lib/client.js
pnpm typecheck                  # 期望 0 错误
```

> `@deepseek-ai/dsh-*` 与 `@deepseek-ai/cordis` 只存在于 DSH 安装里（npm 上只有过期的 `rc`），
> 因此本项目**不把它们写进依赖声明** —— 写了会让 `pnpm install` / `npm install` 去 registry
> 拉不存在的版本而失败。类型改由 `scripts/resolve-dsh-types.mjs` 从运行中的 DSH 解析
> （`pnpm typecheck` 会自动先跑它）；换 DSH 安装后 `pnpm resolve-types` 重跑即可。

## Notes

- `provider` 字面值保持 `instruction-scan`，兼容旧 bundle 已持久化的消息；插件标识/路由/包名已全部改为 `agent-instructions-plus`
- 覆盖行的 `plugins` 是**整表替换**（patch 语义是 replace 而非 merge）：DSH 升级若改动了 shipped preset，已写入的覆盖会固化旧组合，需要在 GUI 里取消再勾选以基于新版重建
- 写入必须是**行级**的：patch 与复制的 preset 行都含 `!!js` 自定义标签（如 `disabled: !!js process.platform === 'win32'`），全量 parse→re-serialize 会把标签求值成普通字符串，导致 `disabled` 变 truthy、shell 工具静默失效
- `~/.dsh/.agent-presets/` 是 DSH 0.1.6 及更早的文件式 preset 目录，0.1.7 起不再被加载；其中残留的 `.aip-backup/` 是历史产物，**不作为恢复源**

