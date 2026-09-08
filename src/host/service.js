import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { compileLayers } from '../core/compiler.js'
import { contentHash } from '../core/canonical.js'
import { expandMacros } from '../core/st-macros.js'
import { exportSillyTavern } from '../core/st-exporter.js'
import { importSillyTavern } from '../core/st-importer.js'
import { hasErrors, mergeDiagnostics } from '../core/diagnostics.js'
import { resolveLayers, validateProfile } from '../core/profile.js'
import { PromptPresetStore, StoreValidationError } from './store.js'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeProfileRef(value) {
  if (typeof value === 'string' && value) return { id: value }
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) return null
  return {
    id: value.id,
    ...(Number.isSafeInteger(value.version) && value.version > 0 ? { version: value.version } : {}),
  }
}

function uniqueProfileRefs(values) {
  const refs = values.map(normalizeProfileRef).filter(Boolean)
  const seen = new Set()
  const result = []
  for (let index = refs.length - 1; index >= 0; index -= 1) {
    const ref = refs[index]
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    result.unshift(ref)
  }
  return result
}

function manifestProfileRefs(manifest) {
  return uniqueProfileRefs([
    ...asArray(manifest?.globalProfiles),
    ...asArray(manifest?.baseProfiles),
    ...asArray(manifest?.cardProfiles),
  ])
}

function pinProfileRefs(refs, state) {
  return uniqueProfileRefs(refs).map(ref => ({
    id: ref.id,
    ...(ref.version ? { version: ref.version } : state.profiles[ref.id]?.version ? { version: state.profiles[ref.id].version } : {}),
  }))
}

function bindingProfileRefs(binding, state) {
  const stored = asArray(binding?.profileRefs)
  return pinProfileRefs(stored.length > 0 ? stored : asArray(binding?.profileIds), state)
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

async function readManifest(manifestPath) {
  if (!manifestPath) return undefined
  try {
    return JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function overlayProfile(binding, overlay, profiles) {
  const byId = new Map(profiles.flatMap(profile => profile.entries).map(entry => [entry.id, entry]))
  const entries = []
  for (const id of asArray(overlay?.enabledEntries)) if (byId.has(id)) entries.push({ ...byId.get(id), enabled: true })
  for (const id of asArray(overlay?.disabledEntries)) if (byId.has(id)) entries.push({ ...byId.get(id), enabled: false })
  for (const [id, value] of Object.entries(overlay?.entryOverrides || {})) if (byId.has(id)) entries.push({ ...byId.get(id), ...value, id })
  const inheritedContract = resolveLayers(profiles).narrativeContract
  const contractOverride = overlay?.narrativeContract || {}
  return validateProfile({
    id: `session-${binding.sessionId}`.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').slice(0, 120),
    name: 'Session overlay',
    entries,
    narrativeContract: {
      ...inheritedContract,
      ...contractOverride,
      protagonistReference: {
        ...inheritedContract.protagonistReference,
        ...(contractOverride.protagonistReference || {}),
      },
    },
  })
}

export class PromptPresetService {
  constructor(store = new PromptPresetStore()) {
    this.store = store
    this.assemblies = new Map()
  }

  async catalog() {
    const state = await this.store.readState()
    return { revision: state.revision, profiles: await this.store.listProfiles(), sessions: Object.keys(state.sessions) }
  }

  async seedDirectory(directory) {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))
    const seeded = []
    for (const file of files) {
      const profile = validateProfile(JSON.parse(await readFile(path.join(directory, file.name), 'utf8')))
      seeded.push(await this.store.seedProfile(profile))
    }
    return seeded
  }

  async getProfile(id, version) {
    return this.store.readProfile(id, version)
  }

  async saveProfile(profile, expectedRevision) {
    return this.store.saveProfile(profile, expectedRevision)
  }

  async importSillyTavern(input, expectedRevision, options = {}) {
    const imported = importSillyTavern(input, options)
    const saved = await this.store.saveProfile(imported.profile, expectedRevision)
    return { ...imported, ...saved }
  }

  async exportSillyTavern(id, version) {
    const profile = await this.store.readProfile(id, version)
    if (!profile) throw new Error(`profile not found: ${id}`)
    return exportSillyTavern(profile)
  }

  async validate(profile) {
    const normalized = validateProfile(profile)
    return { profile: normalized, diagnostics: [], contentHash: contentHash(normalized) }
  }

  async effective(sessionId, manifestPath, variables = {}, parentSessionId = undefined) {
    const manifest = await readManifest(manifestPath)
    const state = await this.store.readState()
    const ownBinding = sessionId ? state.sessions[sessionId] : undefined
    const inheritedBinding = !ownBinding && parentSessionId ? state.sessions[parentSessionId] : undefined
    const binding = ownBinding || inheritedBinding
    const profileRefs = binding
      ? bindingProfileRefs(binding, state)
      : pinProfileRefs(manifestProfileRefs(manifest), state)
    const profiles = []
    const missing = []
    for (const ref of profileRefs) {
      const profile = ref.version ? await this.store.readProfile(ref.id, ref.version) : undefined
      if (profile) profiles.push(profile)
      else missing.push(ref)
    }
    const diagnostics = missing.map(ref => ({
      code: ref.version ? 'missing-profile-version' : 'missing-profile',
      severity: 'error',
      message: ref.version ? `profile version missing: ${ref.id}@${ref.version}` : `profile missing: ${ref.id}`,
      path: `profiles.${ref.id}`,
      details: ref,
    }))
    const selectedOverlay = binding?.overlay ?? manifest?.defaultOverlay
    const overlay = selectedOverlay && profiles.length > 0 ? overlayProfile({ sessionId }, selectedOverlay, profiles) : null
    if (overlay) profiles.push(overlay)
    return {
      manifest,
      binding,
      ownBinding,
      inheritedFrom: inheritedBinding ? parentSessionId : undefined,
      profileRefs,
      profiles,
      diagnostics,
      revision: state.revision,
      missing,
    }
  }

  async sessionEffective(sessionId) {
    const effective = await this.effective(sessionId, undefined)
    if (!effective.binding || effective.profiles.length === 0) return { ...effective, compiled: null }
    const compiled = compileLayers(effective.profiles, {
      strict: false,
      expand: (text, context) => expandMacros(text, context, { strict: false }),
    })
    const diagnostics = mergeDiagnostics(effective.diagnostics, compiled.diagnostics)
    return { ...effective, diagnostics, compiled: { ...compiled, diagnostics, blocked: hasErrors(diagnostics) } }
  }

  async compileForAgent({ manifestPath, sessionId, parentSessionId, variables = {}, strict = true } = {}) {
    const effective = await this.effective(sessionId, manifestPath, variables, parentSessionId)
    if (!effective.manifest) return null
    if (sessionId && !effective.ownBinding) {
      const profileRefs = effective.profileRefs
      const profileIds = profileRefs.map(ref => ref.id)
      const overlay = structuredClone(effective.binding?.overlay ?? effective.manifest.defaultOverlay ?? {})
      const binding = {
        version: 1,
        sessionId,
        profileIds,
        profileRefs,
        overlay,
        contentHash: contentHash({ profileRefs, overlay }),
        appliesFromNextTurn: false,
        updatedAt: new Date().toISOString(),
        ...(effective.inheritedFrom ? { inheritedFrom: effective.inheritedFrom } : {}),
      }
      try {
        const saved = await this.store.saveSessionBinding(sessionId, binding, effective.revision)
        effective.binding = saved.binding
        effective.ownBinding = saved.binding
        effective.revision = saved.state.revision
      } catch {
        effective.binding = await this.store.sessionBinding(sessionId)
        effective.ownBinding = effective.binding
      }
    }
    const compiled = compileLayers(effective.profiles, {
      variables,
      strict,
      expand: (text, context) => expandMacros(text, context, { strict }),
    })
    const diagnostics = mergeDiagnostics(effective.diagnostics, compiled.diagnostics)
    const blocked = compiled.blocked || (strict && hasErrors(diagnostics))
    const result = {
      ...compiled,
      ...(blocked ? { sections: [], renderSections: [] } : {}),
      diagnostics,
      blocked,
      manifest: effective.manifest,
      binding: effective.binding,
      profileRefs: effective.profileRefs,
      revision: effective.revision,
    }
    if (sessionId) this.assemblies.set(sessionId, result)
    return result
  }

  async compileForRender(options = {}) {
    const result = options.sessionId && this.assemblies.has(options.sessionId)
      ? this.assemblies.get(options.sessionId)
      : await this.compileForAgent({ ...options, strict: options.strict ?? true })
    if (!result) return null
    return {
      profileHash: result.profileHash,
      narrativeContract: result.narrativeContract,
      sections: result.renderSections,
      diagnostics: result.diagnostics,
      blocked: result.blocked || hasErrors(result.diagnostics),
    }
  }

  async setSessionOverlay(sessionId, overlay, expectedRevision, profileIds = []) {
    const state = await this.store.readState()
    const existing = state.sessions[sessionId]
    const requestedIds = [...new Set(profileIds.map(String))]
    const existingRefs = bindingProfileRefs(existing, state)
    const existingIds = existingRefs.map(ref => ref.id)
    const profileRefs = requestedIds.length === 0 || sameIds(requestedIds, existingIds)
      ? existingRefs
      : pinProfileRefs(requestedIds, state)
    if (profileRefs.length === 0) throw new StoreValidationError('session overlay requires at least one prompt profile')
    const unpinned = profileRefs.filter(ref => !ref.version)
    if (unpinned.length > 0) throw new StoreValidationError(`prompt profile not found: ${unpinned.map(ref => ref.id).join(', ')}`)
    const binding = {
      version: 1,
      sessionId,
      profileIds: profileRefs.map(ref => ref.id),
      profileRefs,
      overlay: structuredClone(overlay || {}),
      contentHash: contentHash({ profileRefs, overlay }),
      appliesFromNextTurn: true,
      updatedAt: new Date().toISOString(),
    }
    return this.store.saveSessionBinding(sessionId, binding, expectedRevision)
  }

  async clearSessionOverlay(sessionId, expectedRevision) {
    const existing = await this.store.sessionBinding(sessionId)
    if (!existing) return { revision: expectedRevision }
    return this.store.saveSessionBinding(sessionId, {
      ...existing,
      overlay: {},
      appliesFromNextTurn: true,
      updatedAt: new Date().toISOString(),
    }, expectedRevision)
  }

  async revertSessionToCardDefault(sessionId, expectedRevision) {
    return this.store.clearSessionBinding(sessionId, expectedRevision)
  }
}
