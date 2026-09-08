import { createHash } from 'node:crypto'

const STORAGE_FIELDS = new Set(['revision', 'contentHash', 'updatedAt'])

function sortValue(value, omitStorage = false) {
  if (Array.isArray(value)) return value.map(item => sortValue(item, omitStorage))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .filter(key => !omitStorage || !STORAGE_FIELDS.has(key))
      .sort()
      .map(key => [key, sortValue(value[key], omitStorage)]))
  }
  return value
}

export function canonicalize(value, { omitStorage = false } = {}) {
  return JSON.stringify(sortValue(value, omitStorage))
}

export function contentHash(value) {
  return `sha256:${createHash('sha256').update(canonicalize(value, { omitStorage: true }), 'utf8').digest('hex')}`
}

export function withContentHash(profile) {
  return { ...profile, contentHash: contentHash(profile) }
}
