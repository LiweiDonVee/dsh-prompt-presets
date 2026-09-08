import { validateProfile } from './profile.js'

/** User-initiated empty profile; never installed as seed content. */
export function createBlankProfile(id) {
  return validateProfile({ id: id.trim().toLowerCase(), name: id.trim(), description: '', entries: [], variables: {}, groups: {} })
}
