/**
 * instruction-scan Client — @sidleo3/instruction-scan
 *
 * DSH client-plugin contract: the bundle is a CommonJS factory registered via
 * `window.__ModuleLoader__.load({ id, factory })`, exporting `apply`/`inject`.
 * `React` resolves through the loader module table via `require("react")`, and
 * services are consumed through `ctx.get`. RPC to the host goes over
 * `fetch('/api/instruction-scan/*')`.
 *
 * This half drives the Settings → Plugins → Plugin configuration card.
 *
 * @module @sidleo3/instruction-scan/client
 */

import React from 'react'

export const inject = ['slots']

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const h = React.createElement

  // ── Styles ─────────────────────────────────────────────────────
  const CSS = `
    .iscCard { list-style:none; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-3); transition:border-color .16s,background .16s; margin:0 }
    .iscCard:hover { border-color:var(--dsw-alias-label-dimmed) }
    .iscCardOpen { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-label-dimmed) }
    .iscHeader { width:100%; appearance:none; border:0; background:none; font:inherit; color:inherit; text-align:left; cursor:pointer; display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:12px }
    .iscHeader:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px }
    .iscHeadText { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px }
    .iscName { font-size:15px; font-weight:600; line-height:1.4; color:var(--dsw-alias-label-primary) }
    .iscDesc { font-size:13px; line-height:1.5; color:var(--dsw-alias-label-tertiary) }
    .iscChevron { flex:none; color:var(--dsw-alias-label-tertiary); transition:transform .16s; display:inline-flex }
    .iscChevronOpen { transform:rotate(180deg) }
    .iscBody { border-top:1px solid var(--dsw-alias-border-l2); margin:0 16px; padding-top:10px; padding-bottom:8px }
    .iscSectionTitle { font-size:13px; font-weight:600; line-height:1.4; color:var(--dsw-alias-label-primary); margin:0 0 8px }
    .iscToggleRow { display:flex; align-items:flex-start; gap:8px; padding:7px 0; border-bottom:1px solid var(--dsw-alias-border-l2) }
    .iscToggleBody { flex:1 }
    .iscToggleLabel { font-size:13px; font-weight:500; line-height:1.5; color:var(--dsw-alias-label-primary) }
    .iscHint { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-tertiary); margin-top:2px }
    .iscWarn { font-size:12px; color:var(--dsw-alias-label-error); margin-top:6px }
    .iscCheckbox { margin-top:3px; accent-color:var(--dsw-alias-brand-primary) }
    .iscPdRow { display:flex; align-items:center; gap:8px; margin:6px 0; padding:6px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2) }
    .iscRankOrder { color:var(--dsw-alias-label-tertiary); font-size:11px; flex:none; min-width:22px; text-align:right }
    .iscNameInput { flex:1; min-width:0; padding:5px 8px; border-radius:8px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px }
    .iscMiniBtn { appearance:none; border:0; background:none; cursor:pointer; color:var(--dsw-alias-label-tertiary); font-size:13px; padding:2px 4px; flex:none }
    .iscMiniBtn:hover { color:var(--dsw-alias-label-primary) }
    .iscAddBtn { margin-top:6px; appearance:none; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:5px 12px; background:none; color:var(--dsw-alias-label-secondary); font:inherit; font-size:12.5px; cursor:pointer }
    .iscAddBtn:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-label-dimmed) }
    .iscOk { font-size:12.5px; color:var(--dsw-alias-label-primary) }
    .iscError { font-size:12.5px; color:var(--dsw-alias-label-error); margin-top:8px }
    .iscSection { margin-bottom:14px }
  `
  if (typeof document !== 'undefined' && document.getElementById('instruction-scan-css') === null) {
    const tag = document.createElement('style')
    tag.id = 'instruction-scan-css'
    tag.dataset.plugin = '@sidleo3/instruction-scan'
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  // Product-identical IconChevronDownOutline14 SVG path.
  const CHV = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'
  function Chevron(className) {
    return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', className },
      h('path', { d: CHV, fill: 'currentColor' }))
  }

  function InstructionScanCard() {
    const [open, setOpen] = React.useState(false)
    const [config, setConfig] = React.useState(null)
    const [error, setError] = React.useState('')
    const [saved, setSaved] = React.useState(false)

    // host.call is the sandbox RPC to the host half's harness.handle handlers.
    // Guard in case the client-runner doesn't provide it (e.g. older DSH builds).
    var canCall = typeof host !== 'undefined' && host && typeof host.call === 'function'
    console.log('[instruction-scan] canCall:', canCall, 'host:', typeof host)

    React.useEffect(function () {
      let alive = true
      if (canCall) {
        host.call('instruction-scan/get-config')
          .then(function (cfg) { console.log('[instruction-scan] GET via host.call:', cfg); if (alive) setConfig(cfg) })
          .catch(function (err) { console.error('[instruction-scan] GET host.call error:', err) })
      } else {
        fetch('/api/instruction-scan/config').then(function (r) { return r.json() })
          .then(function (cfg) { console.log('[instruction-scan] GET via fetch:', cfg); if (alive) setConfig(cfg) })
          .catch(function (err) { console.error('[instruction-scan] GET fetch error:', err) })
      }
      return function () { alive = false }
    }, [])

    function save(next) {
      setError('')
      setConfig(next)
      setSaved(false)
      function handleResult(result) {
        console.log('[instruction-scan] POST result:', result)
        if (result && result.ok) {
          setConfig(result.config)
          setSaved(true)
        } else {
          throw new Error((result && result.error) || 'save failed')
        }
      }
      if (canCall) {
        host.call('instruction-scan/set-config', next)
          .then(handleResult)
          .catch(function (err) { console.error('[instruction-scan] POST host.call error:', err); setError(String(err && err.message ? err.message : err)) })
      } else {
        fetch('/api/instruction-scan/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        }).then(function (r) { return r.json() })
          .then(handleResult)
          .catch(function (err) { console.error('[instruction-scan] POST fetch error:', err); setError(String(err && err.message ? err.message : err)) })
      }
    }

    // Fallback config while loading (card is always interactive).
    const cfg = config || { scanCwd: true, scanProject: true, scanParents: false, scanGlobal: true, instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'], localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'], projectRootMarkers: ['.git'], dshHome: '~/.dsh' }

    function ToggleRow(label, hint, checked, onToggle) {
      return h('div', { className: 'iscToggleRow', key: label },
        h('input', { type: 'checkbox', className: 'iscCheckbox', checked: checked, onChange: function (e) { onToggle(e.target.checked) } }),
        h('div', { className: 'iscToggleBody' },
          h('div', { className: 'iscToggleLabel' }, label),
          h('div', { className: 'iscHint' }, hint)))
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
        var nextNames = items.slice()
        return h('div', { key: i, className: 'iscPdRow' },
          h('span', { className: 'iscRankOrder' }, '#' + (i + 1)),
          h('input', { className: 'iscNameInput', value: name, placeholder: '如 CODEBUDDY.md', onChange: function (e) { nextNames[i] = e.target.value; save(Object.assign({}, cfg, { [listKey]: nextNames })) } }),
          h('button', { type: 'button', className: 'iscMiniBtn', title: '删除', onClick: function () { nextNames.splice(i, 1); save(Object.assign({}, cfg, { [listKey]: nextNames })) } }, '✕'))
      })
      return h('div', { className: 'iscSection' },
        h('div', { className: 'iscSectionTitle' }, sectionTitle),
        h('div', { className: 'iscHint' }, hint),
        rows,
        h('button', { type: 'button', className: 'iscAddBtn', onClick: function () { save(Object.assign({}, cfg, { [listKey]: items.concat(['']) })) } }, '+ 添加'))
    }

    // ── Toggles ─────────────────────────────────────────────────
    var mutualHint = cfg.scanProject && cfg.scanParents
      ? h('div', { className: 'iscWarn' }, '⚠ 扫描项目目录与遍历上级目录互斥，只能开一项')
      : null
    var toggles = [
      ToggleRow('扫描 cwd 目录（会话工作目录）', '最高优先级 · 直接扫描 cwd 下的指令文件', cfg.scanCwd, function (v) { setToggle('scanCwd', v) }),
      ToggleRow('扫描项目目录', '中等优先级 · 找到项目根后，从根到 cwd 逐级扫描', cfg.scanProject, function (v) { setToggle('scanProject', v) }),
      ToggleRow('遍历所有上级目录', '中等优先级 · 从 cwd 向上逐级扫描直到文件系统根（/）', cfg.scanParents, function (v) { setToggle('scanParents', v) }),
      mutualHint,
      ToggleRow('扫描全局目录', '最低优先级 · 主目录 ~/.dsh/AGENTS.md', cfg.scanGlobal, function (v) { setToggle('scanGlobal', v) }),
    ]

    return h('li', { className: 'iscCard' + (open ? ' iscCardOpen' : '') },
      h('button', { type: 'button', className: 'iscHeader', 'aria-expanded': open ? 'true' : 'false', onClick: function () { setOpen(!open) } },
        h('span', { className: 'iscHeadText' },
          h('span', { className: 'iscName' }, 'AGENTS扫描'),
          h('span', { className: 'iscDesc' }, '可配置 AGENTS.md 发现：cwd/项目/上级遍历/全局 + 自定义候选名与标记')),
        Chevron('iscChevron' + (open ? ' iscChevronOpen' : ''))),
      open ? h('div', { className: 'iscBody' },
        h('div', { className: 'iscSection' },
          h('div', { className: 'iscSectionTitle' }, '扫描层级（开关，优先级从高到低）'),
          toggles,
          saved ? h('div', { className: 'iscOk' }, '✓ 配置已保存') : null),
        CandidateListEditor('基础指令文件候选名', '每个目录下按此顺序检查文件存在性，默认 AGENTS.md、CLAUDE.md', 'instructionFileCandidates'),
        CandidateListEditor('本地覆盖文件候选名', '在基础文件之后检查，默认 AGENTS.local.md、CLAUDE.local.md', 'localInstructionFileCandidates'),
        CandidateListEditor('项目根标记', '向上扫描时，包含此文件/目录的层级被识别为项目根', 'projectRootMarkers'),
        error ? h('div', { className: 'iscError' }, '✕ ' + error) : null) : null)
  }

  slots.inject('settings.plugin.item', function () {
    return slots.register(
      { name: 'settings.plugin.item', id: 'instruction-scan', key: 'instruction-scan', order: 31, label: 'AGENTS扫描' },
      function () { return h(InstructionScanCard) })
  })
}
