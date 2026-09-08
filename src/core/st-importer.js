import { diagnostic, mergeDiagnostics } from './diagnostics.js'
import { normalizeEntry, validateProfile } from './profile.js'
import { expandMacros } from './st-macros.js'

const MARKER_SLOTS = Object.freeze({
  charDescription: 'world',
  charPersonality: 'persona',
  personaDescription: 'persona',
  scenario: 'world',
  worldInfoBefore: 'world',
  worldInfoAfter: 'world',
  dialogueExamples: 'system-pre',
  chatHistory: 'runtime-context',
})

function groupFor(prompt) {
  const name = `${prompt.identifier || ''} ${prompt.name || ''}`
  if (/人称|第一人称|第二人称|第三人称/u.test(name)) return 'pov'
  if (/抢话|转述|不抢话|严禁抢话/u.test(name)) return 'turn-taking'
  if (/角色设定|用户是user|用户是char|用户是上帝视角/u.test(name)) return 'user-role'
  if (/写作模式|聊天模式|创作模式|大总结模式/u.test(name)) return 'mode'
  if (/文风/u.test(name) && prompt.selection === 'multiple') return 'secondary-style'
  if (/文风/u.test(name)) return 'style'
  if (/剧情推进|快速推进|缓慢推进|色色推进/u.test(name)) return 'pacing'
  if (/字数要求|字数 -|动态段落数量/u.test(name)) return 'length'
  return null
}

function selectionFor(group) {
  if (!group) return 'any'
  if (group === 'secondary-style') return 'multiple'
  return 'single'
}

function slotFor(prompt) {
  if (MARKER_SLOTS[prompt.identifier]) return MARKER_SLOTS[prompt.identifier]
  const name = `${prompt.name || ''} ${prompt.content || ''}`
  if (/对话历史|后置|输出|抢话|剧情推进|字数|模式/u.test(name)) return 'pre-response'
  if (/角色设定|人称|用户是/u.test(name)) return 'persona'
  if (/世界设定|世界|场景/u.test(name)) return 'world'
  if (prompt.injection_position === 1) return 'runtime-context'
  return 'system-pre'
}

function activePromptOrder(input) {
  const rows = Array.isArray(input.prompt_order) ? input.prompt_order : []
  const active = rows.find(row => Array.isArray(row?.order)) ?? rows[0]
  return Array.isArray(active?.order) ? active.order : []
}

export function importSillyTavern(input, { id = 'st-import', name = input?.name || 'Imported SillyTavern Preset' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('SillyTavern preset must be an object')
  if (!Array.isArray(input.prompts)) throw new TypeError('SillyTavern preset prompts must be an array')
  const order = activePromptOrder(input)
  const orderById = new Map(order.map((row, index) => [String(row.identifier), { ...row, index }]))
  const diagnostics = []
  const regexScripts = structuredClone(input.extensions?.regex_scripts ?? input.regex_scripts ?? [])
  const tavernHelperScripts = structuredClone(input.extensions?.tavern_helper ?? input.tavern_helper_scripts ?? [])
  if ((Array.isArray(regexScripts) && regexScripts.length > 0) || (!Array.isArray(regexScripts) && regexScripts && Object.keys(regexScripts).length > 0)) {
    diagnostics.push(diagnostic('regex-scripts-unmigrated', 'warning', 'SillyTavern regex scripts were retained but will not execute.'))
  }
  if ((Array.isArray(tavernHelperScripts) && tavernHelperScripts.length > 0) || (!Array.isArray(tavernHelperScripts) && tavernHelperScripts && Object.keys(tavernHelperScripts).length > 0)) {
    diagnostics.push(diagnostic('tavern-helper-unmigrated', 'warning', 'Tavern Helper scripts were retained but will not execute.'))
  }
  const promptIds = new Set(input.prompts.map(prompt => String(prompt.identifier)))
  for (const row of order) {
    if (!promptIds.has(String(row.identifier))) diagnostics.push(diagnostic('prompt-order-missing-prompt', 'error', `prompt_order references absent prompt ${row.identifier}`, `prompt_order.${row.identifier}`))
  }
  const prompts = [...input.prompts].map((prompt, index) => {
    const identifier = String(prompt.identifier ?? `prompt-${index + 1}`)
    const ordered = orderById.get(identifier)
    const source = {
      kind: 'sillytavern',
      identifier,
      originalContent: String(prompt.content ?? ''),
    }
    return normalizeEntry({
      id: identifier.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+/u, '').slice(0, 128) || `prompt-${index + 1}`,
      name: String(prompt.name ?? identifier),
      enabled: ordered?.enabled ?? prompt.enabled !== false,
      group: groupFor(prompt),
      selection: selectionFor(groupFor(prompt)),
      slot: slotFor(prompt),
      order: ordered?.index ?? index,
      depth: prompt.injection_depth ?? null,
      injectionOrder: prompt.injection_order ?? null,
      role: ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system',
      marker: prompt.marker === true,
      content: String(prompt.content ?? ''),
      source,
      renderSafe: prompt.identifier !== 'chatHistory',
      stCompat: {
        identifier,
        injection_position: prompt.injection_position ?? null,
        injection_depth: prompt.injection_depth ?? null,
        injection_order: prompt.injection_order ?? null,
        marker: prompt.marker === true,
        forbid_overrides: prompt.forbid_overrides === true,
        originalPrompt: structuredClone(prompt),
      },
    })
  })
  const profile = validateProfile({
    schemaVersion: 1,
    id: String(id).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+/u, '').slice(0, 128) || 'st-import',
    name,
    version: 1,
    revision: 0,
    description: `Imported from SillyTavern preset ${String(input.name || '')}`.trim(),
    entries: prompts,
    groups: {
      pov: { selection: 'single', required: false },
      'turn-taking': { selection: 'single', required: false },
      'user-role': { selection: 'single', required: false },
      style: { selection: 'single', required: false },
      'secondary-style': { selection: 'multiple', required: false },
      mode: { selection: 'single', required: false },
      pacing: { selection: 'single', required: false },
      length: { selection: 'single', required: false },
    },
    stCompat: {
      sourcePresetName: input.name ?? null,
      sourcePresetVersion: input.version ?? null,
      rawPresetFields: Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'prompts' && key !== 'prompt_order')),
      promptOrder: structuredClone(input.prompt_order ?? []),
      unmigratedExtensions: {
        regexScripts,
        tavernHelperScripts,
      },
      importDiagnostics: diagnostics,
    },
  })
  const preview = { exact: [], degraded: [] }
  for (const entry of prompts) {
    const expanded = expandMacros(entry.content, {}, { strict: false })
    if (expanded.diagnostics.some(item => item.code === 'unsupported-macro' || item.severity === 'error')) preview.degraded.push(entry.id)
    else preview.exact.push(entry.id)
  }
  return { profile, diagnostics: mergeDiagnostics(diagnostics, prompts.flatMap(item => item.diagnostics || [])), preview }
}
