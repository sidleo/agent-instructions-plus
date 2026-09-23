// @ts-nocheck — DSH client-plugin factory is plain JS; tsc strict applies to the host side.
/**
 * agent-instructions-plus Client — @sidleo3/agent-instructions-plus
 *
 * DSH client-plugin contract: the bundle is a CommonJS factory registered via
 * `window.__ModuleLoader__.load({ id, factory })`, exporting `apply`/`inject`.
 * `React` resolves through the loader module table via `require("react")`, and
 * services are consumed through `ctx.get`. RPC to the host goes over
 * `fetch('/api/agent-instructions-plus/*')`.
 *
 * This half drives the plugin's configuration page on the sidebar Plugins page:
 *  - four-layer scan toggles + candidate editors (config RPC)
 *  - per-preset takeover: list presets, enable/disable (apply/remove RPC)
 *
 * DSH 0.1.7 moved per-plugin configuration off Settings → Plugins (whose
 * `settings.plugin.item` slot no longer exists; that section is now the
 * read-only built-in inventory) onto the sidebar **Plugins** page, through the
 * `plugins.bundle.config` slot. The page owns the title, icon and crumb, and
 * renders `view: 'page'` forms with their own save control.
 *
 * @module @sidleo3/agent-instructions-plus/client
 */

import React from 'react'

export const inject = ['slots']

/** The bundle package name; also the `plugins.bundle.config` key. */
const BUNDLE = '@sidleo3/agent-instructions-plus'

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const h = React.createElement

  // ── Styles ─────────────────────────────────────────────────────
  const CSS = `
    .aipSection { margin-bottom:18px }
    .aipSectionTitle { font-size:13px; font-weight:600; line-height:1.4; color:var(--dsw-alias-label-primary); margin:0 0 8px }
    .aipToggleRow { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-bottom:1px solid var(--dsw-alias-border-l2) }
    .aipToggleBody { flex:1 }
    .aipToggleLabel { font-size:13px; font-weight:500; line-height:1.5; color:var(--dsw-alias-label-primary) }
    .aipHint { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-tertiary); margin-top:2px }
    .aipWarn { font-size:12px; color:var(--dsw-alias-label-error); margin-top:6px }
    .aipCheckbox { margin-top:3px; accent-color:var(--dsw-alias-brand-primary) }
    .aipPdRow { display:flex; align-items:center; gap:8px; margin:6px 0; padding:6px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2) }
    .aipRankOrder { color:var(--dsw-alias-label-tertiary); font-size:11px; flex:none; min-width:22px; text-align:right }
    .aipNameInput { flex:1; min-width:0; padding:5px 8px; border-radius:8px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px }
    .aipMiniBtn { appearance:none; border:0; background:none; cursor:pointer; color:var(--dsw-alias-label-tertiary); font-size:13px; padding:2px 4px; flex:none }
    .aipMiniBtn:hover { color:var(--dsw-alias-label-primary) }
    .aipAddBtn { margin-top:6px; appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:5px 12px; background:none; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12.5px; cursor:pointer }
    .aipAddBtn:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-label-dimmed) }
    .aipOk { font-size:12.5px; color:var(--dsw-alias-label-primary); margin-top:8px }
    .aipError { font-size:12.5px; color:var(--dsw-alias-label-error); margin-top:8px }
    .aipPresetRow { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--dsw-alias-border-l2) }
    .aipPresetBody { flex:1; min-width:0 }
    .aipPresetName { font-size:13px; font-weight:500; line-height:1.5; color:var(--dsw-alias-label-primary) }
    .aipPresetDesc { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-tertiary); margin-top:2px }
    .aipTag { display:inline-block; font-size:11px; line-height:1; padding:3px 6px; border-radius:999px; margin-top:4px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary) }
    .aipTagOn { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); color:var(--dsw-alias-brand-primary) }
    .aipTagOff { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary) }
    .aipFooter { display:flex; align-items:center; gap:10px; margin-top:16px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l2) }
    .aipSaveBtn { appearance:none; border:0; border-radius:8px; padding:6px 16px; background:var(--dsw-alias-brand-primary); color:#fff; font:inherit; font-size:13px; cursor:pointer }
    .aipSaveBtn:disabled { opacity:.5; cursor:default }
    .aipResetBtn { appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:6px 14px; background:none; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; cursor:pointer }
    .aipBusy { opacity:.6; pointer-events:none }
  `
  if (typeof document !== 'undefined' && document.getElementById('agent-instructions-plus-css') === null) {
    const tag = document.createElement('style')
    tag.id = 'agent-instructions-plus-css'
    tag.dataset.plugin = BUNDLE
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  /** The composed config the host falls back to before the fetch resolves. */
  const FALLBACK_CONFIG = {
    scanCwd: true, scanProject: false, scanParents: true, scanGlobal: true,
    instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'],
    localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'],
    projectRootMarkers: ['.git'],
    dshHome: '~/.dsh',
  }

  /**
   * Fallback display names for DSH's BUILT-IN presets.
   *
   * The shipped declarations carry no `name` field, so the roster reports the
   * raw id for them and the host cannot supply display text. DSH's own preset
   * picker localizes them through `BUILT_IN_PRESET_KEYS` in
   * `@deepseek-ai/dsh-client-ui-agent-preset`; these strings match its zh
   * dictionary so the two surfaces agree.
   *
   * A CUSTOM preset declares its own name/description, and the host reports
   * those — they always win over this table (see `presetName`).
   */
  const PRESET_NAMES = {
    standard: '标准模式',
    ptc: 'PTC 模式',
    minimal: '极简模式',
    cordis: '创造模式',
  }

  /** One-line descriptions for the built-ins, matching DSH's zh dictionary. */
  const PRESET_DESCRIPTIONS = {
    standard: '处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。',
    ptc: '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。',
    minimal: 'Agent 仅使用终端工具完成任务，适合测试和对比其基础表现。',
    cordis: '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',
  }

  /**
   * The display name for one preset.
   *
   * A custom preset's declared name is authoritative; the built-in table only
   * fills the gap for DSH's shipped presets, which declare none. When neither
   * exists the raw id is the name, with no redundant `（id）` suffix.
   */
  function presetName(preset) {
    const declared = typeof preset.name === 'string' ? preset.name.trim() : ''
    const known = PRESET_NAMES[preset.id]
    // An id echoed back as the name is not display text: a shipped preset
    // declares no name, so the host reports its id there and the localized
    // table is the only real name we have.
    const usable = declared.length > 0 && declared !== preset.id ? declared : undefined
    const display = usable ?? known
    if (display === undefined) return preset.id
    return display === preset.id ? display : display + '（' + preset.id + '）'
  }

  /** The description to show: the preset's own, else the built-in table. */
  function presetDescription(preset) {
    const declared = typeof preset.description === 'string' ? preset.description.trim() : ''
    return declared.length > 0 ? declared : (PRESET_DESCRIPTIONS[preset.id] || '')
  }

  function AgentInstructionsPlusPage() {
    const [saved, setSaved] = React.useState(null)
    const [draft, setDraft] = React.useState(null)
    const [presets, setPresets] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')

    // Formal-host path: the host half registers HTTP JSON endpoints via
    // webServer (harness.handle is a dynamic-plugin-only builtin and is not
    // available to bundle-installed plugins), so the page talks over fetch().
    React.useEffect(function () {
      let alive = true
      fetch('/api/agent-instructions-plus/config').then(function (r) { return r.json() })
        .then(function (cfg) {
          if (!alive) return
          setSaved(cfg); setDraft(cfg)
        })
        .catch(function (err) { if (alive) setError('读取配置失败：' + String(err && err.message ? err.message : err)) })
      fetch('/api/agent-instructions-plus/presets').then(function (r) { return r.json() })
        .then(function (data) { if (alive) setPresets(data && data.presets ? data.presets : []) })
        .catch(function (err) { if (alive) setError('读取预设失败：' + String(err && err.message ? err.message : err)) })
      return function () { alive = false }
    }, [])

    const cfg = draft || FALLBACK_CONFIG
    const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft)

    /** Stage an edit locally; nothing is written until Save. */
    function stage(next) { setDraft(next); setNotice(''); setError('') }

    function save() {
      setBusy(true); setError(''); setNotice('')
      fetch('/api/agent-instructions-plus/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cfg),
      }).then(function (r) { return r.json() })
        .then(function (result) {
          if (!result || !result.ok) throw new Error((result && result.error) || '保存失败')
          setSaved(result.config); setDraft(result.config)
          setNotice('配置已保存，新建会话生效')
          setBusy(false)
        })
        .catch(function (err) { setError(String(err && err.message ? err.message : err)); setBusy(false) })
    }

    function togglePreset(presetId, enable) {
      setBusy(true); setError(''); setNotice('')
      const path = enable ? '/api/agent-instructions-plus/presets/apply' : '/api/agent-instructions-plus/presets/remove'
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ presetId: presetId }),
      }).then(function (r) { return r.json() })
        .then(function (result) {
          if (!result || !result.ok) throw new Error((result && result.error) || '操作失败')
          setNotice(result.message || (enable ? '已接管' : '已取消接管'))
          // Refresh the roster status from the host (source of truth on disk).
          return fetch('/api/agent-instructions-plus/presets').then(function (r) { return r.json() })
        })
        .then(function (data) { if (data) setPresets(data && data.presets ? data.presets : []) ; setBusy(false) })
        .catch(function (err) { setError(String(err && err.message ? err.message : err)); setBusy(false) })
    }

    function ToggleRow(label, hint, checked, onToggle) {
      return h('div', { className: 'aipToggleRow', key: label },
        h('input', { type: 'checkbox', className: 'aipCheckbox', checked: checked, onChange: function (e) { onToggle(e.target.checked) } }),
        h('div', { className: 'aipToggleBody' },
          h('div', { className: 'aipToggleLabel' }, label),
          h('div', { className: 'aipHint' }, hint)))
    }

    function setToggle(key, value) {
      // 扫描项目目录与遍历上级目录互斥：开一项即关另一项。
      if (key === 'scanProject' && value && cfg.scanParents) return stage(Object.assign({}, cfg, { scanProject: true, scanParents: false }))
      if (key === 'scanParents' && value && cfg.scanProject) return stage(Object.assign({}, cfg, { scanParents: true, scanProject: false }))
      stage(Object.assign({}, cfg, { [key]: value }))
    }

    // ── Candidate list editors ──────────────────────────────────
    function CandidateListEditor(sectionTitle, hint, listKey) {
      var items = cfg[listKey] || []
      var rows = items.map(function (name, i) {
        return h('div', { key: i, className: 'aipPdRow' },
          h('span', { className: 'aipRankOrder' }, '#' + (i + 1)),
          h('input', {
            className: 'aipNameInput', value: name, placeholder: '如 CODEBUDDY.md',
            onChange: function (e) { var next = items.slice(); next[i] = e.target.value; stage(Object.assign({}, cfg, { [listKey]: next })) },
          }),
          h('button', { type: 'button', className: 'aipMiniBtn', title: '删除', onClick: function () { var next = items.slice(); next.splice(i, 1); stage(Object.assign({}, cfg, { [listKey]: next })) } }, '✕'))
      })
      return h('div', { className: 'aipSection' },
        h('div', { className: 'aipSectionTitle' }, sectionTitle),
        h('div', { className: 'aipHint' }, hint),
        rows,
        h('button', { type: 'button', className: 'aipAddBtn', onClick: function () { stage(Object.assign({}, cfg, { [listKey]: items.concat(['']) })) } }, '+ 添加'))
    }

    // ── Toggles ─────────────────────────────────────────────────
    var mutualHint = cfg.scanProject && cfg.scanParents
      ? h('div', { className: 'aipWarn' }, '⚠ 扫描项目目录与遍历上级目录互斥，只能开一项')
      : null
    var toggles = [
      ToggleRow('扫描 cwd 目录（会话工作目录）', '最高优先级 · 直接扫描 cwd 下的指令文件', cfg.scanCwd, function (v) { setToggle('scanCwd', v) }),
      ToggleRow('扫描项目目录', '中等优先级 · 找到项目根后，从根到 cwd 逐级扫描', cfg.scanProject, function (v) { setToggle('scanProject', v) }),
      ToggleRow('遍历所有上级目录', '中等优先级 · 从 cwd 向上逐级扫描直到文件系统根（/）', cfg.scanParents, function (v) { setToggle('scanParents', v) }),
      mutualHint,
      ToggleRow('扫描全局目录', '最低优先级 · 主目录 ~/.dsh/AGENTS.md', cfg.scanGlobal, function (v) { setToggle('scanGlobal', v) }),
    ]

    // ── Preset takeover section ─────────────────────────────────
    var presetList = (presets || [])
      .filter(function (p) { return p.hasAgentInstructions })
      .map(function (p) {
        return h('div', { key: p.id, className: 'aipPresetRow' },
          h('input', { type: 'checkbox', className: 'aipCheckbox', checked: !!p.enabled, disabled: busy, onChange: function (e) { togglePreset(p.id, e.target.checked) } }),
          h('div', { className: 'aipPresetBody' },
            h('div', { className: 'aipPresetName' }, presetName(p)),
            h('div', { className: 'aipPresetDesc' }, presetDescription(p)),
            h('span', { className: 'aipTag ' + (p.enabled ? 'aipTagOn' : 'aipTagOff') },
              p.enabled ? '● 已接管' : '○ 内置注入')))
      })
    // `minimal` ships without an agent-instructions row, so it is not
    // takeable — say so instead of leaving the user wondering where it went.
    var skipped = (presets || []).filter(function (p) { return !p.hasAgentInstructions })
    var presetsEmpty = presets !== null && presetList.length === 0
      ? h('div', { className: 'aipHint' }, '未找到含 agent-instructions 行的内置预设，或 agentPresets 服务不可用。')
      : null
    var skippedHint = skipped.length > 0
      ? h('div', { className: 'aipHint' }, '未列出：' + skipped.map(function (p) { return presetName(p) }).join('、') + '（不含 agent-instructions 行，无需接管）')
      : null

    return h('div', { className: busy ? 'aipBusy' : '' },
      h('div', { className: 'aipSection' },
        h('div', { className: 'aipSectionTitle' }, '生效的预设（多选，立即写入 profile patch）'),
        h('div', { className: 'aipHint' }, '勾选 = 在该 profile 的 cordis.patch.yml 写入 preset 覆盖行（禁用其 agent-instructions 行 + 接入本插件注入管线）；取消 = 移除该覆盖行，其余配置逐字节不变。改动对新建会话生效，通常需重启 DSH。'),
        presetsEmpty,
        presetList,
        skippedHint),
      h('div', { className: 'aipSection' },
        h('div', { className: 'aipSectionTitle' }, '扫描层级（开关，优先级从高到低）'),
        toggles),
      CandidateListEditor('基础指令文件候选名', '每个目录下按此顺序检查文件存在性，默认 AGENTS.md、CLAUDE.md', 'instructionFileCandidates'),
      CandidateListEditor('本地覆盖文件候选名', '在基础文件之后检查，默认 AGENTS.local.md、CLAUDE.local.md', 'localInstructionFileCandidates'),
      CandidateListEditor('项目根标记', '向上扫描时，包含此文件/目录的层级被识别为项目根', 'projectRootMarkers'),
      error ? h('div', { className: 'aipError' }, '✕ ' + error) : null,
      notice ? h('div', { className: 'aipOk' }, '✓ ' + notice) : null,
      // The page renders `view: 'page'` forms with their own save control, so
      // edits stay local until Save and leaving the page drops the draft.
      h('div', { className: 'aipFooter' },
        h('button', { type: 'button', className: 'aipSaveBtn', disabled: !dirty || busy, onClick: save }, dirty ? '保存' : '已保存'),
        dirty ? h('button', { type: 'button', className: 'aipResetBtn', disabled: busy, onClick: function () { setDraft(saved); setNotice(''); setError('') } }, '放弃改动') : null))
  }

  // The bundle's own configuration, shown on its page in the sidebar Plugins
  // page between its description and its rows. The key is the package name.
  slots.inject('plugins.bundle.config', function () {
    return slots.register(
      { name: 'plugins.bundle.config', key: BUNDLE, locale: 'agentInstructionsPlus' },
      function () { return h(AgentInstructionsPlusPage) })
  })
}
