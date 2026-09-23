# AGENTS.md — @sidleo3/agent-instructions-plus

> 按 preset 选择性接管 DSH 的 AGENTS.md 指令注入插件。四层扫描（cwd / 项目 / 上级遍历 / 全局）替代内置 `dsh-agent-instructions` 的固定发现逻辑，仅在用户于 Web GUI 显式勾选的 preset 中生效。

## 核心设计（先读这个）

- **安装零改动**：安装后不做任何事，不写任何 preset 覆盖；内置 `agent-instructions` 照常工作
- **用户决定生效范围**：Web GUI（侧边栏 Plugins → 本插件配置页）勾选要接管的 preset（多选）
- **完全替代**：勾选后，向该 profile 的 `cordis.patch.yml` 追加 `- id: preset-<id>` 覆盖行，其 `config.plugins` 是 shipped 组合的副本 —— 内置 `agent-instructions` 行改为 `disabled: true`，末尾追加 `agent-instructions-plus-pipeline` 行（`@sidleo3/agent-instructions-plus/preset`）
- **取消即恢复**：取消勾选 = **行级**移除自己那段 `preset-<id>` 块，其他 patch 段逐字节不变
- **不生效的 preset 不受影响**：未勾选的 preset 完全保持内置行为

## 兼容性基线

**目标 DSH `0.1.7-alpha.2` 及以后。** 两条 0.1.7 的破坏性变更决定了本插件的全部形态：

1. `settings.plugin.item` 槽位被移除（Settings → Plugins 变成只读的内置插件清点），配置页迁到侧边栏 Plugins 的 `plugins.bundle.config`
2. `@deepseek-ai/dsh-agent-preset-registry` 不再扫描 `~/.dsh/.agent-presets/` 目录、也不接受 preset 路径；`list()`/`resolve()` 只返回展示元数据（无 `path`、无读/写组合）。preset 是声明式的 `@deepseek-ai/dsh-agent-preset` Loader 行，覆盖已发布的 preset 只能是 bundle patch

## 关键文件

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Host 入口：provider 注册、GUI RPC、配置读写（`~/.dsh/dsh-instruction-scan.json`） |
| `src/preset.ts` | Session 平面注入管线（`/preset` 子路径）：baseline 合成、增量 reconcile、去重 |
| `src/wizard.ts` | preset 接管管理器：勾选/取消时**行级编辑** profile 的 `cordis.patch.yml`（applyPreset / removePreset / readTakeoverState） |
| `src/composition.ts` | 读取 shipped preset 组合：从 `@deepseek-ai/dsh-web-app/presets/*.patch.yml` 按行捕获插件行原文（保留 `!!js` 标签） |
| `src/config.ts` | 配置归一化（四层扫描开关、文件候选、项目根标记、字节预算） |
| `src/discovery.ts` | 四层扫描目录发现（cwd → project/parents → global） |
| `src/files.ts` | 有界、可中止的指令文件探测与读取（`ctx.fs`，node-fs fallback） |
| `src/state.ts` | 会话可见的 workspace 指令状态与动态 reconcile |
| `src/render.ts` | 面向模型的指令渲染（显式字节预算内） |
| `src/digest.ts` | 内容身份（重复指令抑制） |
| `src/client/` | Web GUI 配置页（`plugins.bundle.config` 槽位；preset 多选 + 四层扫描配置） |

## 构建与发布

```bash
# ⚠️ 必须带 --config.auto-install-peers=false（原因见下）
pnpm install --ignore-scripts --config.auto-install-peers=false
./node_modules/.bin/tsdown      # → lib/index.js + lib/preset.js + lib/client.js
./node_modules/.bin/tsc --noEmit
```

> ⚠️ **构建环境**：`pnpm install` 会去 registry 拉未发布的私有包（`@deepseek-ai/dsh-type-meta` 等）而 404。**光靠 `.npmrc` 的 `auto-install-peers=false` 不够** —— 提交在库里的 `pnpm-lock.yaml` 里写着 `settings.autoInstallPeers: true`，lockfile 的 settings 会覆盖 `.npmrc`。因此必须显式传 `--config.auto-install-peers=false`（命令行的优先级最高）。
>
> `tsc --noEmit` 会有约 28 条 `Cannot find module '@deepseek-ai/dsh-llm'` 一类错误 —— 这些包是 DSH **运行时**注入的，本地没有类型声明，属**已知既有噪音**，不是回归。判断有无回归的办法：`git stash` 后跑一次基线，比对"按文件归一化后的错误集合"，新增项才算问题。

### 发布 npm

```bash
npm version patch --no-git-tag-version
npm publish --ignore-scripts     # 必须 --ignore-scripts：prepack 会触发 pnpm build → 404
```

构建产物的三条校验（发布前必看）：

```bash
grep -cE '^import .*schemastery' lib/index.js        # 期望 0（必须内联，见坑点 3）
head -c 60 lib/client.js | grep -c '__ModuleLoader__' # 期望 1（client 必须是 CJS factory 包装）
grep -c 'plugins.bundle.config' lib/client.js         # 期望 >=1（注册到新槽位）
```

## ⚠️ 关键坑点（踩过）

### 1. 接管编辑必须是行级，禁止 parse→re-serialize

profile patch 与复制的 preset 行都含 `!!js` 自定义 YAML 标签（如 `disabled: !!js process.platform === 'win32'`）。若用 `parseDocument → toJS() → createNode()` 全量重建，`!!js` 会求值为普通字符串 → `disabled` 变 truthy → **bash/shell 工具被禁用**。

正确做法（现状）：`splitRows` 只按**列 0 的 `- id:` / `- insert:`** 切分顶层行（缩进行如 preset 的 `plugins:` 子行、group 的 children、insert block 的子行必须留在父块内），只增删自己的行，其余行逐字节不变。新增行的 `!!js` 表达式由 `composition.ts` 捕获原文后原样回写。

### 2. 取消接管禁止整文件恢复

profile patch 被多个插件共用（本机就有 `BEGIN/END yh-bigdata-mcp (managed)` 等块，其他插件还会写自己的 `insert`）。`removePreset` 若从备份整文件恢复，会**抹掉其他插件的配置**。必须反向行级编辑：只删自己的 `preset-<id>` 块。`.aip-backup/cordis.patch.yml` 仅作审计留存，**不用于恢复**。

### 3. schemastery 必须内联，不能 external

`@deepseek-ai/schemastery` 是 peerDependency，但 **DSH 运行时不提供该模块**（不在 loader 模块表）。tsdown 默认把 peerDeps 当 external，产物里 `import z from "@deepseek-ai/schemastery"` 会导致 DSH 启动报 `ERR_MODULE_NOT_FOUND`。构建配置必须保持 `noExternal: (id) => (RUNTIME_EXTERNALS.includes(id) ? undefined : true)` 把非运行时依赖强制内联。

> 现状：0.1.7 起 host 不再注册 settings namespace（配置走 `webServer` HTTP 端点 + client 侧 `fetch`），因此 `index.ts` 已不再 import schemastery。这条规则仍适用于任何新引入的 peerDep。

### 4. `!!js` 标签与禁用判断

- `readTakeoverState` 判断接管状态时用 `disabled === true`（严格布尔），`!!js` 解析出的字符串不会误判
- `applyPreset` 幂等判断：`pipelineActive && builtinDisabled` 才视为已接管
- 写入前先删掉同 id 的既有 `preset-<id>` 块，避免重复覆盖行叠加

### 5. 尾随换行不能重复计一次

`text.split(/\r?\n/)` 对以换行结尾的文件会产生一个尾随空元素。`joinRows` 若原样 join 再补 `eol`，文件会每次长出空行 —— 导致"取消接管后无法还原成原文件"。已修正：join 前先 `pop()` 那个空元素，再按 `trailingNewline` 补回。

### 6. `config:` 子块的缩进层级

shipped patch 里插件行的缩进是：`plugins:`(4) → 行 opener(6) → 行内 key(8) → `config:` 的 body(10)。`composition.ts` 把 body 去缩进到列 0 后，`wizard.ts` 必须按 `行缩进+2` 重新缩进 body。缩进错位生成的 YAML 仍能解析，但 `config` 会挂到错误的层级 —— **必须用 `parseDocument(...).toJS()` 断言结构**，只比字符串看不出来。

## 运行时架构速览

```
DSH Host 进程
  └─ @sidleo3/agent-instructions-plus (bundle)
       ├─ index.js  (host)  → provider `instruction-scan` + webServer HTTP RPC + wizard
       │                       └─ 写 profile 的 cordis.patch.yml: `- id: preset-<id>` 覆盖行
       └─ preset.js (session) → 注入管线，由被接管 preset 的覆盖行加载
            └─ agent-pre-step 钩子：合成 workspace 指令 baseline + 增量 reconcile
```

- 会话创建时 preset 组合固定；GUI 勾选/取消只影响**之后新建**的会话，且通常需重启 DSH 让 patch 重新合成
- 配置持久化在 `~/.dsh/dsh-instruction-scan.json`（GUI 修改即时生效，下次 pre-step 重读）
- 消息注入标记 `provider: instruction-scan`（兼容旧 bundle 已持久化的消息）
- 覆盖行的 `plugins` 是**整表替换**：DSH 升级改动 shipped preset 后，旧覆盖会固化旧组合，需在 GUI 取消再勾选以重建
