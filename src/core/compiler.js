import { hasErrors, mergeDiagnostics } from './diagnostics.js'
import { contentHash, withContentHash } from './canonical.js'
import { resolveLayers, SLOT_ORDER, validateProfile } from './profile.js'

function renderContract(contract) {
  const reference = contract.protagonistReference || {}
  const hybrid = contract.hybridRules
    ? `\n混合镜头：世界与 NPC=${contract.hybridRules.worldAndNpc}；主角=${contract.hybridRules.protagonist}。`
    : ''
  return [
    '<narrative_contract>',
    `玩家角色：${contract.playerRole}。`,
    `视角：${contract.pov}。${hybrid}`,
    `主角指代：${reference.name || '当前主角'}；代词：${(reference.pronouns || []).join('、') || '按卡面自然指代'}；自称：${reference.selfReference || '我'}。`,
    `内心权限：${contract.interiorAccess}；玩家输入处理：${contract.inputEcho}；玩家决策权：${contract.agency}。`,
    `时态：${contract.tense}；语言：${contract.language}。`,
    '</narrative_contract>',
  ].join('\n')
}

function sectionText(entry) {
  const header = entry.marker ? '' : `<prompt_entry id="${entry.id}" name="${entry.name}">`
  const footer = entry.marker ? '' : '</prompt_entry>'
  return [header, entry.content, footer].filter(Boolean).join('\n')
}

function slotSections(entries, contract, { render = false } = {}) {
  const selected = entries.filter(entry => render
    ? entry.renderSafe && !entry.settlementOnly
    : entry.renderOnly !== true)
  const sections = []
  for (const slot of SLOT_ORDER) {
    const rows = selected.filter(entry => entry.slot === slot)
    if (rows.length === 0) continue
    const body = rows.map(sectionText).join('\n\n')
    const text = [slot === 'pre-response' ? renderContract(contract) : '', body].filter(Boolean).join('\n\n')
    sections.push({ name: `dsh-prompt-presets:${slot}`, slot, order: SLOT_ORDER.indexOf(slot) * 100 - 80, text, entryIds: rows.map(entry => entry.id) })
  }
  if (!sections.some(section => section.slot === 'pre-response')) sections.push({ name: 'dsh-prompt-presets:narrative-contract', slot: 'pre-response', order: 320, text: renderContract(contract), entryIds: [] })
  return sections.sort((left, right) => left.order - right.order)
}

export function compileLayers(layers, { expand = (text) => ({ text, diagnostics: [] }), variables = {}, strict = true } = {}) {
  const resolved = resolveLayers(layers)
  const allExpanded = []
  const macroDiagnostics = []
  let layeredVariables = Object.assign({}, ...layers.map(layer => layer?.variables || {}), variables)
  const orderedAll = [...resolved.allEntries].sort((left, right) => SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot)
    || left.order - right.order
    || (left.injectionOrder ?? 0) - (right.injectionOrder ?? 0)
    || left.id.localeCompare(right.id))
  for (const entry of orderedAll) {
    const result = entry.enabled ? expand(entry.content, { ...layeredVariables, variables: layeredVariables }) : { text: entry.content, diagnostics: [], variables: layeredVariables }
    if (result.variables && typeof result.variables === 'object') layeredVariables = { ...result.variables }
    allExpanded.push({ ...entry, content: result.text })
    macroDiagnostics.push(...(result.diagnostics || []).map(item => ({ ...item, path: item.path || `entries.${entry.id}.content` })))
  }
  const expandedById = new Map(allExpanded.map(entry => [entry.id, entry]))
  const expanded = resolved.entries.map(entry => expandedById.get(entry.id))
  const profileDiagnostics = layers.flatMap(layer => layer?.stCompat?.importDiagnostics || [])
  const diagnostics = mergeDiagnostics(resolved.diagnostics, profileDiagnostics, macroDiagnostics)
  const semanticProfile = withContentHash({
    schemaVersion: 1,
    id: 'effective',
    version: 1,
    name: 'Effective Prompt Profile',
    description: '',
    entries: allExpanded,
    narrativeContract: resolved.narrativeContract,
    groups: resolved.groups,
    variables: {},
    stCompat: {},
  })
  const profileHash = contentHash(semanticProfile)
  if (strict && hasErrors(diagnostics)) return { entries: expanded, allEntries: allExpanded, sections: [], renderSections: [], narrativeContract: resolved.narrativeContract, diagnostics, profileHash, provenance: resolved.provenance, blocked: true }
  const sections = slotSections(expanded, resolved.narrativeContract)
  const renderSections = slotSections(expanded, resolved.narrativeContract, { render: true })
  for (const target of [sections, renderSections]) {
    if (target.length > 0) target[0] = { ...target[0], text: `<prompt_profile hash="${profileHash}" />\n\n${target[0].text}` }
  }
  return {
    entries: expanded,
    allEntries: allExpanded,
    sections,
    renderSections,
    narrativeContract: resolved.narrativeContract,
    diagnostics,
    profileHash,
    provenance: resolved.provenance,
    variables: layeredVariables,
    blocked: false,
  }
}
