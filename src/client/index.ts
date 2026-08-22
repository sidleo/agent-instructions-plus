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
 * This half drives the Settings → Plugins → Plugin configuration card:
 *  - four-layer scan toggles + candidate editors (config RPC)
 *  - per-preset takeover: list presets, enable/disable (apply/remove RPC)
 *
 * @module @sidleo3/agent-instructions-plus/client
 */

import React from 'react'

export const inject = ['slots']

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const h = React.createElement

  // ── Styles ─────────────────────────────────────────────────────
  const CSS = `
    .aipCard { list-style:none; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-3); transition:border-color .16s,background .16s; margin:0 }
    .aipCard:hover { border-color:var(--dsw-alias-label-dimmed) }
    .aipCardOpen { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-label-dimmed) }
    .aipHeader { width:100%; appearance:none; border:0; background:none; font:inherit; color:inherit; text-align:left; cursor:pointer; display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:12px }
    .aipHeader:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px }
    .aipHeadText { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px }
    .aipName { font-size:15px; font-weight:600; line-height:1.4; color:var(--dsw-alias-label-primary) }
    .aipDesc { font-size:13px; line-height:1.5; color:var(--dsw-alias-label-tertiary) }
    .aipChevron { flex:none; color:var(--dsw-alias-label-tertiary); transition:transform .16s; display:inline-flex }
    .aipChevronOpen { transform:rotate(180deg) }
    .aipBody { border-top:1px solid var(--dsw-alias-border-l2); margin:0 16px; padding-top:10px; padding-bottom:8px }
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
    .aipOk { font-size:12.5px; color:var(--dsw-alias-label-primary) }
    .aipError { font-size:12.5px; color:var(--dsw-alias-label-error); margin-top:8px }
    .aipSection { margin-bottom:14px }
    .aipPresetRow { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid var(--dsw-alias-border-l2) }
    .aipPresetBody { flex:1; min-width:0 }
    .aipPresetName { font-size:13px; font-weight:500; line-height:1.5; color:var(--dsw-alias-label-primary) }
    .aipPresetDesc { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-tertiary); margin-top:2px }
    .aipTag { display:inline-block; font-size:11px; line-height:1; padding:3px 6px; border-radius:999px; margin-top:4px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary) }
    .aipTagOn { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); color:var(--dsw-alias-brand-primary) }
    .aipTagOff { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-tertiary) }
    .aipTagDirty { background:color-mix(in srgb, var(--dsw-alias-label-error) 14%, transparent); color:var(--dsw-alias-label-error) }
    .aipBusy { opacity:.6; pointer-events:none }
  `
  if (typeof document !== 'undefined' && document.getElementById('agent-instructions-plus-css') === null) {
    const tag = document.createElement('style')
    tag.id = 'agent-instructions-plus-css'
    tag.dataset.plugin = '@sidleo3/agent-instructions-plus'
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  // Product-identical IconChevronDownOutline14 SVG path.
  const CHV = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.3623 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'
  function Chevron(className) {
    return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', className },
      h('path', { d: CHV, fill: 'currentColor' }))
  }

  function AgentInstructionsPlusCard(props) {
    const [open, setOpen] = React.useState(!!(props && props.initialOpen))
    const [config, setConfig] = React.useState(null)
    const [presets, setPresets] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [saved, setSaved] = React.useState(false)
    const [presetMsg, setPresetMsg] = React.useState('')

    // Formal-host path: the host half registers HTTP JSON endpoints via
    // webServer (harness.handle is a dynamic-plugin-only builtin and is not
    // available to bundle-installed plugins), so the card talks over fetch().
    React.useEffect(function () {
      let alive = true
      fetch('/api/agent-instructions-plus/config').then(function (r) { return r.json() })
        .then(function (cfg) { console.log('[agent-instructions-plus] GET config:', cfg); if (alive) setConfig(cfg) })
        .catch(function (err) { console.error('[agent-instructions-plus] GET config error:', err) })
      fetch('/api/agent-instructions-plus/presets').then(function (r) { return r.json() })
        .then(function (data) { console.log('[agent-instructions-plus] GET presets:', data); if (alive) setPresets(data && data.presets ? data.presets : []) })
        .catch(function (err) { console.error('[agent-instructions-plus] GET presets error:', err) })
      return function () { alive = false }
    }, [])

    function save(next) {
      setError('')
      setConfig(next)
      setSaved(false)
      function handleResult(result) {
        console.log('[agent-instructions-plus] POST result:', result)
        if (result && result.ok) {
          setConfig(result.config)
          setSaved(true)
        } else {
          throw new Error((result && result.error) || 'save failed')
        }
      }
      fetch('/api/agent-instructions-plus/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      }).then(function (r) { return r.json() })
        .then(handleResult)
        .catch(function (err) { console.error('[agent-instructions-plus] POST config error:', err); setError(String(err && err.message ? err.message : err)) })
    }

    function togglePreset(presetId, enable) {
      setBusy(true)
      setError('')
      setPresetMsg('')
      const path = enable ? '/api/agent-instructions-plus/presets/apply' : '/api/agent-instructions-plus/presets/remove'
      fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ presetId: presetId }),
      }).then(function (r) { return r.json() })
        .then(function (result) {
          console.log('[agent-instructions-plus] togglePreset:', presetId, enable, result)
          if (result && result.ok) {
            setPresetMsg(result.message || (enable ? '已生效' : '已取消'))
            // Refresh the roster status from the host (source of truth on disk).
            return fetch('/api/agent-instructions-plus/presets').then(function (r) { return r.json() })
          }
          throw new Error((result && result.error) || '操作失败')
        })
        .then(function (data) {
          if (data) { setPresets(data && data.presets ? data.presets : []); setBusy(false) }
        })
        .catch(function (err) { console.error('[agent-instructions-plus] togglePreset error:', err); setError(String(err && err.message ? err.message : err)); setBusy(false) })
    }

    // Fallback config while loading (card is always interactive).
    const cfg = config || { scanCwd: true, scanProject: true, scanParents: false, scanGlobal: true, instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'], localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'], projectRootMarkers: ['.git'], dshHome: '~/.dsh' }

    function ToggleRow(label, hint, checked, onToggle) {
      return h('div', { className: 'aipToggleRow', key: label },
        h('input', { type: 'checkbox', className: 'aipCheckbox', checked: checked, onChange: function (e) { onToggle(e.target.checked) } }),
        h('div', { className: 'aipToggleBody' },
          h('div', { className: 'aipToggleLabel' }, label),
          h('div', { className: 'aipHint' }, hint)))
    }

    function setToggle(key, value) {
      if (key === 'scanProject' && value && cfg.scanParents) return save(Object.assign({}, cfg, { scanProject: true, scanParents: false }))
      if (key === 'scanParents' && value && cfg.scanProject) return save(Object.assign({}, cfg, { scanParents: true, scanProject: false }))
      save(Object.assign({}, cfg, { [key]: value }))
    }

    // ── Candidate list editors ──────────────────────────────────
    function CandidateListEditor(sectionTitle, hint, listKey) {
      var items = cfg[listKey] || []
      var rows = items.map(function (name, i) {
        // Editing stays local: onChange only updates state so intermediate
        // values (e.g. "." while typing ".git") never hit a host save that
        // would filter them out. The save happens on blur with trimmed,
        // non-empty values only.
        return h('div', { key: i, className: 'aipPdRow' },
          h('span', { className: 'aipRankOrder' }, '#' + (i + 1)),
          h('input', { className: 'aipNameInput', value: name, placeholder: '如 CODEBUDDY.md', onChange: function (e) { var next = items.slice(); next[i] = e.target.value; setConfig(Object.assign({}, cfg, { [listKey]: next })) }, onBlur: function () { save(Object.assign({}, cfg, { [listKey]: items.map(function (v) { return v.trim() }).filter(Boolean) })) } }),
          h('button', { type: 'button', className: 'aipMiniBtn', title: '删除', onClick: function () { var next = items.slice(); next.splice(i, 1); save(Object.assign({}, cfg, { [listKey]: next })) } }, '✕'))
      })
      return h('div', { className: 'aipSection' },
        h('div', { className: 'aipSectionTitle' }, sectionTitle),
        h('div', { className: 'aipHint' }, hint),
        rows,
        h('button', { type: 'button', className: 'aipAddBtn', onClick: function () { setConfig(Object.assign({}, cfg, { [listKey]: items.concat(['']) })) } }, '+ 添加'))
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
            h('div', { className: 'aipPresetName' }, p.name),
            h('div', { className: 'aipPresetDesc' }, (p.description || '') + (p.id ? '（' + p.id + '）' : '')),
            h('span', { className: 'aipTag ' + (p.enabled ? 'aipTagOn' : (p.copyExists ? 'aipTagDirty' : 'aipTagOff')) },
              p.enabled ? '● 已接管' : (p.backupExists ? '⚠ 接管不完整（升级可能覆盖了配置，重新勾选修复）' : '○ 内置注入'))))
      })
    var presetsEmpty = presetList.length === 0
      ? h('div', { className: 'aipHint' }, '未找到含 agent-instructions 行的预设，或 agentPresets 服务不可用。')
      : null

    return h('li', { className: 'aipCard' + (open ? ' aipCardOpen' : '') + (busy ? ' aipBusy' : '') },
      h('button', { type: 'button', className: 'aipHeader', 'aria-expanded': open ? 'true' : 'false', onClick: function () { setOpen(!open) } },
        h('span', { className: 'aipHeadText' },
          h('span', { className: 'aipName' }, 'AGENTS注入（agent-instructions-plus）'),
          h('span', { className: 'aipDesc' }, '按 preset 接管 AGENTS.md 注入：四层扫描 + 自定义候选名；勾选 preset 直接修改其配置生效，取消即恢复')),
        Chevron('aipChevron' + (open ? ' aipChevronOpen' : ''))),
      open ? h('div', { className: 'aipBody' },
        h('div', { className: 'aipSection' },
          h('div', { className: 'aipSectionTitle' }, '生效的预设（多选，立即生效于新建会话）'),
          h('div', { className: 'aipHint' }, '勾选 = 直接修改该 preset 配置（禁用其 agent-instructions 行 + 接入本插件注入管线）；取消 = 从备份恢复原始配置。升级 DSH 若覆盖配置，重新勾选即可。'),
          presetsEmpty,
          presetList,
          presetMsg ? h('div', { className: 'aipOk' }, '✓ ' + presetMsg) : null),
        h('div', { className: 'aipSection' },
          h('div', { className: 'aipSectionTitle' }, '扫描层级（开关，优先级从高到低）'),
          toggles,
          saved ? h('div', { className: 'aipOk' }, '✓ 配置已保存') : null),
        CandidateListEditor('基础指令文件候选名', '每个目录下按此顺序检查文件存在性，默认 AGENTS.md、CLAUDE.md', 'instructionFileCandidates'),
        CandidateListEditor('本地覆盖文件候选名', '在基础文件之后检查，默认 AGENTS.local.md、CLAUDE.local.md', 'localInstructionFileCandidates'),
        CandidateListEditor('项目根标记', '向上扫描时，包含此文件/目录的层级被识别为项目根', 'projectRootMarkers'),
        error ? h('div', { className: 'aipError' }, '✕ ' + error) : null) : null)
  }

  // Config card under Settings → Plugins → configurable tab. The card shows
  // only when the host serves the settings namespace (registered in index.ts);
  // a dedicated tab is intentionally NOT used so the config lives with the
  // other plugin cards.
  slots.inject('settings.plugin.item', function () {
    return slots.register(
      { name: 'settings.plugin.item', id: 'agent-instructions-plus', key: 'agent-instructions-plus', order: 31, label: 'AGENTS注入' },
      function () { return h(AgentInstructionsPlusCard) })
  })
}

