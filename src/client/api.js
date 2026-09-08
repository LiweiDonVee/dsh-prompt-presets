const PREFIX = '/prompt-presets/api'

export class ClientApiError extends Error {
  constructor(message, status = 0, details = {}) {
    super(message)
    this.name = 'ClientApiError'
    this.status = status
    this.details = details
  }
}

async function payload(response) {
  const type = response.headers?.get?.('content-type') || ''
  if (!type.toLowerCase().includes('application/json')) throw new ClientApiError(`Prompt Presets API returned HTTP ${response.status} instead of JSON.`, response.status)
  let body
  try { body = await response.json() } catch (error) { throw new ClientApiError(`Prompt Presets API returned invalid JSON: ${error.message}`, response.status) }
  if (!response.ok || body?.ok !== true) throw new ClientApiError(body?.error || `Prompt Presets API failed with HTTP ${response.status}.`, response.status, body || {})
  return body
}

async function request(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`${PREFIX}${path}`, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return payload(response)
}

export const loadCatalog = fetchImpl => request('/catalog', { fetchImpl })
export const loadProfile = (id, version, fetchImpl) => request(`/profiles/${encodeURIComponent(id)}${version ? `?version=${encodeURIComponent(version)}` : ''}`, { fetchImpl })
export const saveProfile = (profile, expectedRevision, fetchImpl) => request(`/profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: { profile, expectedRevision }, fetchImpl })
export const importSillyTavern = (preset, expectedRevision, options, fetchImpl) => request('/import/sillytavern', { method: 'POST', body: { preset, expectedRevision, options }, fetchImpl })
export const exportSillyTavern = (id, version, fetchImpl) => request('/export/sillytavern', { method: 'POST', body: { id, version }, fetchImpl })
export const validateProfile = (profile, fetchImpl) => request('/validate', { method: 'POST', body: { profile }, fetchImpl })
export const loadSessionEffective = (sessionId, fetchImpl) => request(`/sessions/${encodeURIComponent(sessionId)}/effective`, { fetchImpl })
export const saveSessionOverlay = (sessionId, overlay, profileIds, expectedRevision, fetchImpl) => request(`/sessions/${encodeURIComponent(sessionId)}/overlay`, { method: 'PUT', body: { overlay, profileIds, expectedRevision }, fetchImpl })
export const resetSessionOverlay = (sessionId, expectedRevision, fetchImpl) => request(`/sessions/${encodeURIComponent(sessionId)}/overlay`, { method: 'DELETE', body: { expectedRevision }, fetchImpl })
export const revertSessionToCardDefault = (sessionId, expectedRevision, fetchImpl) => request(`/sessions/${encodeURIComponent(sessionId)}/overlay`, { method: 'DELETE', body: { expectedRevision, revertToCardDefault: true }, fetchImpl })
