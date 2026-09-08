import { diagnostic } from './diagnostics.js'

function positionFor(entry) {
  if (entry.slot === 'runtime-context') return 1
  return 0
}

export function exportSillyTavern(profile) {
  const raw = profile.stCompat?.rawPresetFields && typeof profile.stCompat.rawPresetFields === 'object'
    ? structuredClone(profile.stCompat.rawPresetFields)
    : {}
  const diagnostics = []
  const prompts = profile.entries.map((entry) => {
    const source = entry.stCompat?.originalPrompt && typeof entry.stCompat.originalPrompt === 'object'
      ? structuredClone(entry.stCompat.originalPrompt)
      : {}
    return {
      ...source,
      identifier: entry.stCompat?.identifier ?? entry.source?.identifier ?? entry.id,
      name: entry.name,
      enabled: entry.enabled,
      injection_position: entry.stCompat?.injection_position ?? positionFor(entry),
      injection_depth: entry.depth,
      injection_order: entry.injectionOrder ?? entry.order,
      role: entry.role,
      marker: entry.marker,
      content: entry.content,
      forbid_overrides: entry.stCompat?.forbid_overrides ?? false,
    }
  })
  const order = profile.entries.map(entry => ({
    identifier: entry.stCompat?.identifier ?? entry.source?.identifier ?? entry.id,
    enabled: entry.enabled,
  }))
  const preset = {
    ...raw,
    name: profile.stCompat?.sourcePresetName ?? profile.name,
    prompts,
    prompt_order: [{ character_id: 100001, order }],
    extensions: {
      ...(raw.extensions && typeof raw.extensions === 'object' ? raw.extensions : {}),
      dsh_prompt_presets: {
        profileId: profile.id,
        version: profile.version,
        diagnostics,
      },
    },
  }
  for (const entry of profile.entries) {
    if (entry.stCompat?.unmigrated || entry.diagnostics?.length) diagnostics.push(diagnostic('entry-roundtrip-degraded', 'warning', `entry ${entry.id} may not round-trip exactly`, `entries.${entry.id}`))
  }
  return { preset, diagnostics }
}
