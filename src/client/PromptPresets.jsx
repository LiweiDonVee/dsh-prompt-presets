import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBlankProfile } from '../core/blank-profile.js'

import {
  ClientApiError,
  exportSillyTavern,
  importSillyTavern,
  loadCatalog,
  loadProfile,
  loadSessionEffective,
  resetSessionOverlay,
  revertSessionToCardDefault,
  saveProfile,
  saveSessionOverlay,
  validateProfile,
} from './api.js'
import { IconCheck, IconChevronDown, IconChevronRight, IconCopy, IconPlus, IconRefresh, IconTrash, IconWarning } from './icons.jsx'

const SLOTS = ['system-pre', 'persona', 'world', 'runtime-context', 'pre-response', 'final-contract', 'render-style', 'render-contract']
const SELECTIONS = ['single', 'multiple', 'any']

const clone = value => JSON.parse(JSON.stringify(value))
const messageOf = error => error instanceof Error ? error.message : String(error)

function IconButton({ label, onClick, disabled, danger, children }) {
  return <button type="button" className={`pp-icon${danger ? ' danger' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function Field({ label, children, wide = false }) {
  return <label className={`pp-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}</label>
}

function DiagnosticList({ diagnostics = [] }) {
  if (diagnostics.length === 0) return <p className="pp-muted">无诊断</p>
  return <ul className="pp-diagnostics">{diagnostics.map((item, index) => (
    <li key={`${item.code}-${index}`} data-severity={item.severity}><IconWarning size={14} /><span><strong>{item.code}</strong>{item.message}</span></li>
  ))}</ul>
}

function ContractEditor({ value, onChange }) {
  const contract = value || {}
  const reference = contract.protagonistReference || {}
  const set = (field, next) => onChange({ ...contract, [field]: next })
  return <div className="pp-contract-grid">
    <Field label="玩家角色"><select value={contract.playerRole || 'player-character'} onChange={event => set('playerRole', event.target.value)}><option value="player-character">player-character</option><option value="agent-character">agent-character</option><option value="observer">observer</option></select></Field>
    <Field label="视角"><select value={contract.pov || 'third-limited'} onChange={event => set('pov', event.target.value)}><option value="first">first</option><option value="second">second</option><option value="third-limited">third-limited</option><option value="third-objective">third-objective</option><option value="hybrid">hybrid</option></select></Field>
    <Field label="主角名称"><input value={reference.name || ''} onChange={event => set('protagonistReference', { ...reference, name: event.target.value })} /></Field>
    <Field label="主角代词"><input value={(reference.pronouns || []).join('、')} onChange={event => set('protagonistReference', { ...reference, pronouns: event.target.value.split(/[、,]/u).map(item => item.trim()).filter(Boolean) })} /></Field>
    <Field label="自称"><input value={reference.selfReference || '我'} onChange={event => set('protagonistReference', { ...reference, selfReference: event.target.value })} /></Field>
    <Field label="内心权限"><select value={contract.interiorAccess || 'protagonist-only'} onChange={event => set('interiorAccess', event.target.value)}><option value="protagonist-only">protagonist-only</option><option value="none">none</option><option value="omniscient">omniscient</option></select></Field>
    <Field label="输入转述"><select value={contract.inputEcho || 'paraphrase'} onChange={event => set('inputEcho', event.target.value)}><option value="paraphrase">paraphrase</option><option value="verbatim">verbatim</option><option value="no-repeat">no-repeat</option></select></Field>
    <Field label="玩家决策权"><select value={contract.agency || 'never-decide'} onChange={event => set('agency', event.target.value)}><option value="never-decide">never-decide</option><option value="light-improv">light-improv</option><option value="full-improv">full-improv</option></select></Field>
    {contract.pov === 'hybrid' ? <><Field label="世界 / NPC"><select value={contract.hybridRules?.worldAndNpc || 'third-objective'} onChange={event => set('hybridRules', { ...(contract.hybridRules || {}), worldAndNpc: event.target.value })}><option value="third-objective">third-objective</option><option value="third-limited">third-limited</option></select></Field><Field label="主角"><select value={contract.hybridRules?.protagonist || 'first'} onChange={event => set('hybridRules', { ...(contract.hybridRules || {}), protagonist: event.target.value })}><option value="first">first</option><option value="second">second</option><option value="third-limited">third-limited</option></select></Field></> : null}
  </div>
}

function EntryEditor({ entry, onChange, onDelete, onMove, index, count, t }) {
  if (!entry) return <div className="pp-empty-editor">选择一个条目</div>
  const set = (field, value) => onChange({ ...entry, [field]: value })
  return <div className="pp-entry-editor">
    <div className="pp-entry-editor-head"><strong>{entry.name || entry.id}</strong><div className="pp-row"><IconButton label={t('moveUp')} disabled={index === 0} onClick={() => onMove(-1)}><IconChevronDown size={14} className="pp-up" /></IconButton><IconButton label={t('moveDown')} disabled={index === count - 1} onClick={() => onMove(1)}><IconChevronDown size={14} /></IconButton><IconButton label={t('deleteEntry')} danger onClick={onDelete}><IconTrash size={14} /></IconButton></div></div>
    <div className="pp-form-grid">
      <Field label="ID"><input value={entry.id} onChange={event => set('id', event.target.value.toLowerCase())} /></Field>
      <Field label="名称"><input value={entry.name} onChange={event => set('name', event.target.value)} /></Field>
      <Field label="分组"><input value={entry.group || ''} onChange={event => set('group', event.target.value || null)} /></Field>
      <Field label="选择模式"><select value={entry.selection || 'any'} onChange={event => set('selection', event.target.value)}>{SELECTIONS.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="注入位置"><select value={entry.slot} onChange={event => set('slot', event.target.value)}>{SLOTS.map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label="角色"><select value={entry.role || 'system'} onChange={event => set('role', event.target.value)}><option>system</option><option>user</option><option>assistant</option></select></Field>
      <Field label="顺序"><input type="number" value={entry.order ?? 0} onChange={event => set('order', Number(event.target.value))} /></Field>
      <Field label="深度"><input type="number" value={entry.depth ?? ''} onChange={event => set('depth', event.target.value === '' ? null : Number(event.target.value))} /></Field>
      <Field label="注入顺序"><input type="number" value={entry.injectionOrder ?? ''} onChange={event => set('injectionOrder', event.target.value === '' ? null : Number(event.target.value))} /></Field>
      <label className="pp-check"><input type="checkbox" checked={entry.enabled !== false} onChange={event => set('enabled', event.target.checked)} />启用</label>
      <label className="pp-check"><input type="checkbox" checked={entry.marker === true} onChange={event => set('marker', event.target.checked)} />Marker</label>
      <label className="pp-check"><input type="checkbox" checked={entry.renderSafe !== false} onChange={event => set('renderSafe', event.target.checked)} />Render safe</label>
      <label className="pp-check"><input type="checkbox" checked={entry.settlementOnly === true} onChange={event => set('settlementOnly', event.target.checked)} />Settlement only</label>
      <Field label="提示词" wide><textarea value={entry.content || ''} onChange={event => set('content', event.target.value)} /></Field>
    </div>
  </div>
}

export function PromptPresets({ t }) {
  const [catalog, setCatalog] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState(null)
  const [selectedEntry, setSelectedEntry] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState([])
  const importRef = useRef(null)

  const refresh = useCallback(async (prefer = selectedId) => {
    setError('')
    const next = await loadCatalog()
    setCatalog(next)
    const id = next.profiles.some(item => item.id === prefer) ? prefer : next.profiles[0]?.id || ''
    setSelectedId(id)
    if (id) {
      const loaded = await loadProfile(id)
      setDraft(clone(loaded.profile))
      setSelectedEntry(loaded.profile?.entries?.[0]?.id || '')
      setDiagnostics(loaded.profile?.stCompat?.importDiagnostics || [])
    } else setDraft(null)
  }, [selectedId])

  useEffect(() => { void refresh().catch(value => setError(messageOf(value))) }, [])

  const choose = async (id, version) => {
    setSelectedId(id); setBusy(true); setError('')
    try { const loaded = await loadProfile(id, version); setDraft(clone(loaded.profile)); setSelectedEntry(loaded.profile.entries[0]?.id || ''); setDiagnostics(loaded.profile.stCompat?.importDiagnostics || []) } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const selectedIndex = draft?.entries.findIndex(entry => entry.id === selectedEntry) ?? -1
  const filtered = useMemo(() => (catalog?.profiles || []).filter(item => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase())), [catalog, query])

  const persist = async (profile = draft) => {
    if (!profile || !catalog) return
    setBusy(true); setError(''); setNotice('')
    try { await saveProfile(profile, catalog.revision); setNotice(`已保存 ${profile.id}`); await refresh(profile.id) } catch (value) { if (value instanceof ClientApiError && value.status === 409) await refresh(profile.id); setError(messageOf(value)) } finally { setBusy(false) }
  }
  const validate = async () => {
    setBusy(true); setError('')
    try { const result = await validateProfile(draft); setDiagnostics(result.diagnostics || []); setNotice(`校验通过 · ${result.contentHash}`) } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const importFile = async event => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !catalog) return
    setBusy(true); setError('')
    try {
      const preset = JSON.parse(await file.text())
      const proposed = (file.name.replace(/\.json$/iu, '').toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || `st-${Date.now().toString(36)}`)
      const id = window.prompt('Profile ID', proposed)
      if (!id) return
      const result = await importSillyTavern(preset, catalog.revision, { id, name: file.name.replace(/\.json$/iu, '') })
      setDiagnostics(result.diagnostics || []); setNotice(`已导入 ${result.profile.entries.length} 个条目`); await refresh(result.profile.id)
    } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const exportFile = async () => {
    if (!draft) return
    setBusy(true); setError('')
    try {
      const result = await exportSillyTavern(draft.id, draft.version)
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(result.preset, null, 2)}\n`], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `${draft.id}.st.json`; link.click(); URL.revokeObjectURL(url)
    } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const duplicate = async () => {
    if (!draft) return
    const id = window.prompt('New profile ID', `${draft.id}-copy`)
    if (!id) return
    await persist({ ...clone(draft), id: id.toLowerCase(), name: `${draft.name} Copy`, version: 1, revision: 0, contentHash: undefined })
  }

  const createProfile = async () => {
    const id = window.prompt(t('profileId'), `profile-${Date.now().toString(36)}`)
    if (!id) return
    try {
      const profile = createBlankProfile(id)
      if (catalog.profiles.some(item => item.id === profile.id)) throw new Error(t('idExists'))
      await persist(profile)
    } catch (value) { setError(messageOf(value)) }
  }

  if (!catalog) return <div className="pp-state">{error || t('loading')}</div>
  return <div className="pp-shell">
    <div className="pp-actions"><button className="pp-button" onClick={createProfile} disabled={busy}><IconPlus size={14} />{t('create')}</button>{catalog.profiles.length === 0 ? <p className="pp-muted">{t('emptyHelp')}</p> : null}</div>
    <header className="pp-toolbar"><div className="pp-actions"><button className="pp-button primary" onClick={() => persist()} disabled={!draft || busy}>{t('save')}</button><button className="pp-button" onClick={validate} disabled={!draft || busy}>{t('validate')}</button><button className="pp-button" onClick={() => importRef.current?.click()} disabled={busy}>{t('import')}</button><button className="pp-button" onClick={exportFile} disabled={!draft || busy}>{t('export')}</button><button className="pp-button" onClick={duplicate} disabled={!draft || busy}><IconCopy size={14} />{t('duplicate')}</button><IconButton label="刷新" onClick={() => refresh()} disabled={busy}><IconRefresh size={16} /></IconButton><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importFile} /></div><div className="pp-hash">{draft?.contentHash || ''}</div></header>
    {(notice || error) ? <div className={`pp-notice${error ? ' error' : ''}`}>{error || notice}</div> : null}
    <div className="pp-workspace">
      <aside className="pp-sidebar"><input className="pp-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} />{filtered.length ? <ul>{filtered.map(item => <li key={item.id}><button className={item.id === selectedId ? 'active' : ''} onClick={() => choose(item.id)}><span>{item.name}</span><code>{item.id}</code></button>{item.id === selectedId && item.versions?.length > 1 ? <select value={draft?.version || item.version} onChange={event => choose(item.id, Number(event.target.value))}>{[...item.versions].reverse().map(version => <option key={version} value={version}>v{version}</option>)}</select> : null}</li>)}</ul> : <p className="pp-muted">{t('empty')}</p>}</aside>
      {draft ? <main className="pp-main">
        <section className="pp-profile-band"><div className="pp-form-grid"><Field label="Profile ID"><input value={draft.id} disabled /></Field><Field label="名称"><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="描述" wide><input value={draft.description || ''} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field></div></section>
        <section className="pp-section"><h3>{t('contract')}</h3><ContractEditor value={draft.narrativeContract} onChange={narrativeContract => setDraft({ ...draft, narrativeContract })} /></section>
        <section className="pp-section pp-entry-section"><div className="pp-section-head"><h3>{t('entries')} <span>{draft.entries.length}</span></h3><button className="pp-button" onClick={() => { const id = `entry-${Date.now().toString(36)}`; setDraft({ ...draft, entries: [...draft.entries, { id, name: 'New Entry', enabled: true, group: null, selection: 'any', slot: 'pre-response', order: draft.entries.length * 10, depth: null, injectionOrder: null, role: 'system', marker: false, content: '', tags: [], required: false, renderSafe: true, settlementOnly: false, diagnostics: [] }] }); setSelectedEntry(id) }}><IconPlus size={14} />{t('addEntry')}</button></div><div className="pp-entry-grid"><nav className="pp-entry-list">{draft.entries.map(entry => <button key={entry.id} className={entry.id === selectedEntry ? 'active' : ''} onClick={() => setSelectedEntry(entry.id)}><input type="checkbox" tabIndex={-1} checked={entry.enabled !== false} readOnly /><span>{entry.name}</span><code>{entry.slot}</code></button>)}</nav><EntryEditor t={t} entry={selectedIndex >= 0 ? draft.entries[selectedIndex] : null} index={selectedIndex} count={draft.entries.length} onChange={next => { const entries = [...draft.entries]; entries[selectedIndex] = next; setDraft({ ...draft, entries }); setSelectedEntry(next.id) }} onDelete={() => { const entries = draft.entries.filter((_, index) => index !== selectedIndex); setDraft({ ...draft, entries }); setSelectedEntry(entries[Math.max(0, selectedIndex - 1)]?.id || '') }} onMove={delta => { const target = selectedIndex + delta; if (target < 0 || target >= draft.entries.length) return; const entries = [...draft.entries]; [entries[selectedIndex], entries[target]] = [entries[target], entries[selectedIndex]]; entries.forEach((entry, index) => { entry.order = index * 10 }); setDraft({ ...draft, entries }) }} /></div></section>
        <section className="pp-section"><h3>{t('diagnostics')}</h3><DiagnosticList diagnostics={diagnostics} /></section>
      </main> : null}
    </div>
  </div>
}

export function PromptSessionDock({ sessionId, t }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState(null)
  const [entries, setEntries] = useState([])
  const [availableProfiles, setAvailableProfiles] = useState([])
  const [profileIds, setProfileIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const [result, catalog] = await Promise.all([loadSessionEffective(sessionId), loadCatalog()])
      setState(result)
      setEntries((result.compiled?.allEntries || result.compiled?.entries || []).map(clone))
      setAvailableProfiles(catalog.profiles || [])
      setProfileIds(result.binding?.profileIds || result.profileRefs?.map(ref => ref.id) || [])
      setError('')
    } catch (value) { setError(messageOf(value)) }
  }, [sessionId])
  useEffect(() => { void load() }, [load])
  if (!state?.binding || !state.compiled) return null
  const apply = async () => {
    setBusy(true)
    try {
      const enabledEntries = entries.filter(entry => entry.enabled).map(entry => entry.id)
      const disabledEntries = entries.filter(entry => !entry.enabled).map(entry => entry.id)
      await saveSessionOverlay(sessionId, { enabledEntries, disabledEntries }, profileIds, state.revision)
      await load()
    } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const reset = async () => {
    setBusy(true)
    try { await resetSessionOverlay(sessionId, state.revision); await load() } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  const cardDefault = async () => {
    setBusy(true)
    try { await revertSessionToCardDefault(sessionId, state.revision); setState(null) } catch (value) { setError(messageOf(value)) } finally { setBusy(false) }
  }
  return <div className="pp-dock">
    <button type="button" className="pp-dock-head" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}<strong>{t('session')}</strong><code>{state.compiled.profileHash?.slice(0, 20)}</code>{state.binding.appliesFromNextTurn ? <span>{t('nextTurn')}</span> : null}</button>
    {open ? <div className="pp-dock-body">
      {error ? <p className="pp-error">{error}</p> : null}
      <DiagnosticList diagnostics={state.diagnostics || []} />
      <div className="pp-muted">{t('profile')}</div>
      <div className="pp-dock-entries">{availableProfiles.map(profile => <label key={profile.id}><input type="checkbox" checked={profileIds.includes(profile.id)} onChange={event => setProfileIds(current => event.target.checked ? [...current.filter(id => id !== profile.id), profile.id] : current.filter(id => id !== profile.id))} /><span>{profile.name}</span><code>v{profile.version}</code></label>)}</div>
      <div className="pp-muted">{t('entries')}</div>
      <div className="pp-dock-entries">{entries.map((entry, index) => <label key={entry.id}><input type="checkbox" checked={entry.enabled !== false} onChange={event => { const next = [...entries]; next[index] = { ...entry, enabled: event.target.checked }; if (entry.group && entry.selection === 'single' && event.target.checked) next.forEach((candidate, candidateIndex) => { if (candidateIndex !== index && candidate.group === entry.group) next[candidateIndex] = { ...candidate, enabled: false } }); setEntries(next) }} /><span>{entry.name}</span><code>{entry.group || entry.slot}</code></label>)}</div>
      <div className="pp-dock-actions"><button className="pp-button primary" disabled={busy || profileIds.length === 0} onClick={apply}><IconCheck size={14} />{t('applyNext')}</button><button className="pp-button" disabled={busy} onClick={reset}>{t('reset')}</button><button className="pp-button" disabled={busy} onClick={cardDefault}>{t('cardDefault')}</button></div>
    </div> : null}
  </div>
}
