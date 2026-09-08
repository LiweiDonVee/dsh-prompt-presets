import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { contentHash, withContentHash } from '../core/canonical.js'
import { validateProfile } from '../core/profile.js'

export const STORE_VERSION = 1

export class StoreValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StoreValidationError'
  }
}

export class RevisionConflictError extends Error {
  constructor(expected, current) {
    super(`prompt preset revision conflict: expected ${expected}, current ${current}`)
    this.name = 'RevisionConflictError'
    this.expectedRevision = expected
    this.currentRevision = current
  }
}

export class StoreFormatError extends Error {
  constructor(filePath, cause) {
    super(`cannot read prompt preset store at ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'StoreFormatError'
    this.filePath = filePath
    this.cause = cause
  }
}

export function resolveStoreRoot(environment = process.env) {
  const dshHome = environment.DSH_HOME?.trim()
    ? path.resolve(environment.DSH_HOME.trim())
    : path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'prompt-presets')
}

function emptyState() {
  return { schemaVersion: STORE_VERSION, revision: 0, profiles: {}, sessions: {} }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateState(input) {
  if (!isRecord(input)) throw new StoreValidationError('store state must be an object')
  if (input.schemaVersion !== STORE_VERSION) throw new StoreValidationError(`store schemaVersion must be ${STORE_VERSION}`)
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new StoreValidationError('store revision must be a non-negative safe integer')
  if (!isRecord(input.profiles) || !isRecord(input.sessions)) throw new StoreValidationError('store profiles and sessions must be objects')
  return {
    schemaVersion: STORE_VERSION,
    revision: input.revision,
    profiles: structuredClone(input.profiles),
    sessions: structuredClone(input.sessions),
  }
}

export class PromptPresetStore {
  #queue = Promise.resolve()

  constructor(root = resolveStoreRoot()) {
    this.root = path.resolve(root)
    this.statePath = path.join(this.root, 'state.json')
    this.profileRoot = path.join(this.root, 'profiles')
  }

  async readState() {
    let source
    try {
      source = await readFile(this.statePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyState()
      throw new StoreFormatError(this.statePath, error)
    }
    try {
      return validateState(JSON.parse(source))
    } catch (error) {
      if (error instanceof StoreValidationError) throw new StoreFormatError(this.statePath, error)
      throw new StoreFormatError(this.statePath, error)
    }
  }

  async #writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, filePath)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  saveState(candidate, expectedRevision) {
    const operation = this.#queue.then(() => this.#saveState(candidate, expectedRevision))
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #saveState(candidate, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new StoreValidationError('expectedRevision must be a non-negative safe integer')
    const current = await this.readState()
    if (current.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, current.revision)
    const next = validateState({ ...candidate, schemaVersion: STORE_VERSION, revision: current.revision + 1 })
    await this.#writeJson(this.statePath, next)
    return next
  }

  async listProfiles() {
    const state = await this.readState()
    return Object.values(state.profiles).sort((a, b) => a.id.localeCompare(b.id))
  }

  async readProfile(id, version = undefined) {
    const state = await this.readState()
    const metadata = state.profiles[id]
    if (!metadata) return undefined
    const selectedVersion = version ?? metadata.version
    const filePath = path.join(this.profileRoot, id, `v${selectedVersion}.json`)
    try {
      const profile = validateProfile(JSON.parse(await readFile(filePath, 'utf8')))
      if (contentHash(profile) !== metadata.contentHash && selectedVersion === metadata.version) throw new StoreFormatError(filePath, new Error('profile content hash does not match state metadata'))
      return profile
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      if (error instanceof StoreFormatError) throw error
      throw new StoreFormatError(filePath, error)
    }
  }

  async saveProfile(candidate, expectedRevision) {
    const profile = validateProfile(candidate)
    const operation = this.#queue.then(async () => {
      const state = await this.readState()
      if (state.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, state.revision)
      const previous = state.profiles[profile.id]
      const nextVersion = previous ? previous.version + 1 : Math.max(1, profile.version)
      const nextProfile = withContentHash({ ...profile, version: nextVersion, revision: state.revision + 1 })
      const filePath = path.join(this.profileRoot, nextProfile.id, `v${nextProfile.version}.json`)
      await this.#writeJson(filePath, nextProfile)
      const nextState = {
        ...state,
        revision: state.revision + 1,
        profiles: {
          ...state.profiles,
          [nextProfile.id]: {
            id: nextProfile.id,
            name: nextProfile.name,
            version: nextProfile.version,
            revision: nextProfile.revision,
            contentHash: nextProfile.contentHash,
            updatedAt: new Date().toISOString(),
            versions: [...new Set([...(Array.isArray(previous?.versions) ? previous.versions : previous ? [previous.version] : []), nextProfile.version])].sort((a, b) => a - b),
          },
        },
      }
      await this.#writeJson(this.statePath, nextState)
      return { profile: nextProfile, state: nextState }
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async seedProfile(profile) {
    const state = await this.readState()
    if (state.profiles[profile.id]) return this.readProfile(profile.id)
    return (await this.saveProfile(profile, state.revision)).profile
  }

  async sessionBinding(sessionId) {
    const state = await this.readState()
    return state.sessions[sessionId] ? structuredClone(state.sessions[sessionId]) : undefined
  }

  async saveSessionBinding(sessionId, binding, expectedRevision) {
    const operation = this.#queue.then(async () => {
      const state = await this.readState()
      if (state.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, state.revision)
      const sessions = { ...state.sessions, [sessionId]: structuredClone(binding) }
      const next = await this.#saveState({ ...state, sessions }, expectedRevision)
      return { binding: structuredClone(binding), state: next }
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async clearSessionBinding(sessionId, expectedRevision) {
    const operation = this.#queue.then(async () => {
      const state = await this.readState()
      if (state.revision !== expectedRevision) throw new RevisionConflictError(expectedRevision, state.revision)
      const sessions = { ...state.sessions }
      delete sessions[sessionId]
      return this.#saveState({ ...state, sessions }, expectedRevision)
    })
    this.#queue = operation.catch(() => undefined)
    return operation
  }
}
