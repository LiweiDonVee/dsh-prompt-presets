import { diagnostic } from './diagnostics.js'

export const PROFILE_SCHEMA_VERSION = 1
export const SLOT_ORDER = Object.freeze([
  'system-pre',
  'persona',
  'world',
  'runtime-context',
  'pre-response',
  'final-contract',
  'render-style',
  'render-contract',
])
export const SLOTS = new Set(SLOT_ORDER)
export const ROLES = new Set(['system', 'user', 'assistant'])
export const SELECTIONS = new Set(['single', 'multiple', 'any'])
export const POVS = new Set(['first', 'second', 'third-limited', 'third-objective', 'hybrid'])

export class ProfileValidationError extends Error {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message)
    this.name = 'ProfileValidationError'
    this.path = path
  }
}

function fail(message, path) {
  throw new ProfileValidationError(message, path)
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function string(value, path, { optional = false, max = 200000 } = {}) {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string') fail('must be a string', path)
  if (value.length > max) fail(`must be at most ${max} characters`, path)
  return value
}

function id(value, path) {
  const checked = string(value, path)
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(checked)) fail('must match [a-z0-9][a-z0-9_-]{0,127}', path)
  return checked
}

function finiteNumber(value, path, optional = false) {
  if (value === null && optional) return null
  if (value === undefined && optional) return null
  if (!Number.isFinite(value)) fail('must be a finite number', path)
  return value
}

function narrativeContract(input = {}) {
  if (!record(input)) fail('must be an object', 'narrativeContract')
  const contract = {
    playerRole: input.playerRole ?? 'player-character',
    pov: input.pov ?? 'third-limited',
    protagonistReference: {
      name: String(input.protagonistReference?.name ?? ''),
      pronouns: Array.isArray(input.protagonistReference?.pronouns)
        ? input.protagonistReference.pronouns.map(String)
        : [],
      selfReference: String(input.protagonistReference?.selfReference ?? '我'),
    },
    interiorAccess: input.interiorAccess ?? 'protagonist-only',
    inputEcho: input.inputEcho ?? 'paraphrase',
    agency: input.agency ?? 'never-decide',
    tense: input.tense ?? 'present',
    language: input.language ?? 'zh-CN',
    ...(input.hybridRules ? { hybridRules: structuredClone(input.hybridRules) } : {}),
  }
  const enums = [
    ['playerRole', ['player-character', 'agent-character', 'observer']],
    ['pov', [...POVS]],
    ['interiorAccess', ['protagonist-only', 'none', 'omniscient']],
    ['inputEcho', ['paraphrase', 'verbatim', 'no-repeat']],
    ['agency', ['never-decide', 'light-improv', 'full-improv']],
    ['tense', ['past', 'present']],
  ]
  for (const [field, values] of enums) if (!values.includes(contract[field])) fail(`must be one of ${values.join(', ')}`, `narrativeContract.${field}`)
  if (contract.pov === 'hybrid') {
    if (!record(contract.hybridRules) || !contract.hybridRules.worldAndNpc || !contract.hybridRules.protagonist) {
      fail('hybrid POV requires hybridRules.worldAndNpc and hybridRules.protagonist', 'narrativeContract.hybridRules')
    }
  }
  return contract
}

function normalizeSource(input, path) {
  if (input === undefined) return undefined
  if (!record(input)) fail('must be an object', path)
  return {
    kind: String(input.kind ?? 'native'),
    ...(input.identifier === undefined ? {} : { identifier: String(input.identifier) }),
    ...(input.originalContent === undefined ? {} : { originalContent: String(input.originalContent) }),
    ...(input.sourcePath === undefined ? {} : { sourcePath: String(input.sourcePath) }),
  }
}

export function normalizeEntry(input, index = 0) {
  if (!record(input)) fail('must be an object', `entries[${index}]`)
  const entryId = id(input.id ?? input.identifier, `entries[${index}].id`)
  const slot = input.slot ?? 'pre-response'
  if (!SLOTS.has(slot)) fail(`must be one of ${SLOT_ORDER.join(', ')}`, `entries[${index}].slot`)
  const role = input.role ?? 'system'
  if (!ROLES.has(role)) fail('must be system, user, or assistant', `entries[${index}].role`)
  const selection = input.selection ?? 'any'
  if (!SELECTIONS.has(selection)) fail('must be single, multiple, or any', `entries[${index}].selection`)
  const normalized = {
    id: entryId,
    name: String(input.name ?? entryId),
    enabled: input.enabled !== false,
    group: input.group === null || input.group === undefined ? null : String(input.group),
    selection,
    slot,
    order: finiteNumber(input.order ?? index * 10, `entries[${index}].order`),
    depth: finiteNumber(input.depth, `entries[${index}].depth`, true),
    injectionOrder: finiteNumber(input.injectionOrder, `entries[${index}].injectionOrder`, true),
    role,
    marker: input.marker === true,
    content: string(input.content ?? '', `entries[${index}].content`),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    required: input.required === true,
    renderSafe: input.renderSafe !== false,
    settlementOnly: input.settlementOnly === true,
    ...(input.renderOnly === true ? { renderOnly: true } : {}),
    source: normalizeSource(input.source, `entries[${index}].source`),
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics.map(item => ({ ...item })) : [],
    ...(input.stCompat === undefined ? {} : { stCompat: structuredClone(input.stCompat) }),
  }
  if (normalized.name.length > 240) fail('must be at most 240 characters', `entries[${index}].name`)
  return normalized
}

export function validateProfile(input) {
  if (!record(input)) fail('profile must be an object')
  if (input.schemaVersion !== undefined && input.schemaVersion !== PROFILE_SCHEMA_VERSION) fail(`schemaVersion must be ${PROFILE_SCHEMA_VERSION}`, 'schemaVersion')
  const profileId = id(input.id, 'id')
  const entries = Array.isArray(input.entries) ? input.entries.map(normalizeEntry) : []
  const ids = new Set()
  for (const entry of entries) {
    if (ids.has(entry.id)) fail(`duplicate entry id ${entry.id}`, 'entries')
    ids.add(entry.id)
  }
  const groups = record(input.groups) ? structuredClone(input.groups) : {}
  for (const [groupId, group] of Object.entries(groups)) {
    if (!record(group)) fail('must be an object', `groups.${groupId}`)
    if (group.selection !== undefined && !SELECTIONS.has(group.selection)) fail('invalid selection', `groups.${groupId}.selection`)
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: profileId,
    name: String(input.name ?? profileId),
    version: Number.isSafeInteger(input.version) && input.version > 0 ? input.version : 1,
    revision: Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    kind: 'dsh-prompt-profile',
    description: String(input.description ?? ''),
    entries,
    groups,
    variables: record(input.variables) ? structuredClone(input.variables) : {},
    narrativeContract: narrativeContract(input.narrativeContract),
    ...(input.narrativeContractMode === 'inherit' ? { narrativeContractMode: 'inherit' } : {}),
    stCompat: record(input.stCompat) ? structuredClone(input.stCompat) : {},
    ...(input.contentHash ? { contentHash: String(input.contentHash) } : {}),
    ...(input.updatedAt ? { updatedAt: String(input.updatedAt) } : {}),
  }
}

export function resolveLayers(layers) {
  if (!Array.isArray(layers)) fail('layers must be an array', 'layers')
  const entries = new Map()
  const groups = new Map()
  let contract = narrativeContract()
  const provenance = new Map()
  const diagnostics = []
  for (const [layerIndex, raw] of layers.entries()) {
    const profile = validateProfile(raw)
    if (profile.narrativeContractMode !== 'inherit') {
      contract = { ...contract, ...profile.narrativeContract, protagonistReference: { ...contract.protagonistReference, ...profile.narrativeContract.protagonistReference } }
    }
    for (const [groupId, group] of Object.entries(profile.groups)) groups.set(groupId, structuredClone(group))
    for (const entry of profile.entries) {
      entries.set(entry.id, entry)
      provenance.set(entry.id, { profileId: profile.id, layerIndex, version: profile.version })
    }
  }
  const active = [...entries.values()]
  const byGroup = new Map([...groups].map(([groupId]) => [groupId, []]))
  for (const entry of active) {
    if (!entry.enabled || !entry.group) continue
    const list = byGroup.get(entry.group) ?? []
    list.push(entry)
    byGroup.set(entry.group, list)
  }
  for (const [group, selected] of byGroup) {
    const definition = groups.get(group) || {}
    const selection = definition.selection || (active.some(entry => entry.group === group && entry.selection === 'single') ? 'single' : 'any')
    if (selection === 'single' && selected.length > 1) diagnostics.push(diagnostic('single-selection-conflict', 'error', `group ${group} has multiple enabled entries`, `groups.${group}`, { ids: selected.map(item => item.id) }))
    if (definition.required === true && selected.length === 0) diagnostics.push(diagnostic('required-group-empty', 'error', `group ${group} requires one enabled entry`, `groups.${group}`))
  }
  const sorted = active
    .filter(entry => entry.enabled)
    .sort((left, right) => SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot)
      || left.order - right.order
      || (left.injectionOrder ?? 0) - (right.injectionOrder ?? 0)
      || left.id.localeCompare(right.id))
  return {
    entries: sorted,
    allEntries: active,
    groups: Object.fromEntries(groups),
    narrativeContract: contract,
    diagnostics,
    provenance: Object.fromEntries([...provenance].map(([key, value]) => [key, value])),
  }
}
