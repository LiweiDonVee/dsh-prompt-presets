import { RevisionConflictError, StoreFormatError, StoreValidationError } from './store.js'

export const API_PREFIX = '/prompt-presets/api'
export const MAX_BODY_BYTES = 8 * 1024 * 1024

class ApiValidationError extends Error {}

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function loopback(address) {
  if (typeof address !== 'string') return false
  const value = address.toLowerCase()
  return value === '::1' || value.startsWith('127.') || value.startsWith('::ffff:127.')
}

async function readJson(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_BODY_BYTES) throw new ApiValidationError('request body is too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) throw new ApiValidationError('request body is required')
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) { throw new ApiValidationError(`request body must be valid JSON: ${error.message}`) }
}

function routeParts(pathname) {
  const route = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) || '/' : pathname
  return route.split('/').filter(Boolean).map(decodeURIComponent)
}

export function createApiHandler(service, connection) {
  if (typeof connection?.requestRejection !== 'function') throw new TypeError('DSH connection authentication is required')
  return async function promptPresetsApi(req, res) {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) return json(res, rejection, { ok: false, error: rejection === 401 ? 'Open the DSH launch URL to authenticate this browser.' : 'DSH rejected this request host or origin.' })
    if (!loopback(req.socket?.remoteAddress)) return json(res, 403, { ok: false, error: 'Prompt Presets API is available only from this machine.' })
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const parts = routeParts(requestUrl.pathname)
    try {
      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'catalog') return json(res, 200, { ok: true, ...(await service.catalog()) })
      if (req.method === 'GET' && parts[0] === 'profiles' && parts[1]) {
        const version = requestUrl.searchParams.has('version') ? Number(requestUrl.searchParams.get('version')) : undefined
        return json(res, 200, { ok: true, profile: await service.getProfile(parts[1], version) })
      }
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'profiles') {
        const body = await readJson(req)
        return json(res, 200, { ok: true, ...(await service.saveProfile(body.profile, body.expectedRevision)) })
      }
      if (req.method === 'PUT' && parts[0] === 'profiles' && parts[1]) {
        const body = await readJson(req)
        return json(res, 200, { ok: true, ...(await service.saveProfile({ ...body.profile, id: parts[1] }, body.expectedRevision)) })
      }
      if (req.method === 'POST' && parts.join('/') === 'import/sillytavern') {
        const body = await readJson(req)
        return json(res, 200, { ok: true, ...(await service.importSillyTavern(body.preset, body.expectedRevision, body.options)) })
      }
      if (req.method === 'POST' && parts.join('/') === 'export/sillytavern') {
        const body = await readJson(req)
        return json(res, 200, { ok: true, ...(await service.exportSillyTavern(body.id, body.version)) })
      }
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'validate') {
        const body = await readJson(req)
        return json(res, 200, { ok: true, ...(await service.validate(body.profile)) })
      }
      if (parts[0] === 'sessions' && parts[1]) {
        if (req.method === 'GET' && parts[2] === 'effective') return json(res, 200, { ok: true, ...(await service.sessionEffective(parts[1])) })
        if (req.method === 'PUT' && parts[2] === 'overlay') {
          const body = await readJson(req)
          return json(res, 200, { ok: true, ...(await service.setSessionOverlay(parts[1], body.overlay, body.expectedRevision, body.profileIds)) })
        }
        if (req.method === 'DELETE' && parts[2] === 'overlay') {
          const body = await readJson(req)
          if (body.revertToCardDefault === true) return json(res, 200, { ok: true, ...(await service.revertSessionToCardDefault(parts[1], body.expectedRevision)) })
          return json(res, 200, { ok: true, ...(await service.clearSessionOverlay(parts[1], body.expectedRevision)) })
        }
      }
      return json(res, 404, { ok: false, error: `not found: ${req.method ?? 'UNKNOWN'} /${parts.join('/')}` })
    } catch (error) {
      if (error instanceof RevisionConflictError) return json(res, 409, { ok: false, error: error.message, currentRevision: error.currentRevision })
      if (error instanceof ApiValidationError || error instanceof StoreValidationError) return json(res, 400, { ok: false, error: error.message })
      if (error instanceof StoreFormatError) return json(res, 500, { ok: false, error: error.message, readOnly: true, path: error.filePath })
      return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
