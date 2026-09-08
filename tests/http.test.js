import test from 'node:test'
import assert from 'node:assert/strict'

import { createApiHandler as createAuthenticatedApiHandler } from '../src/host/http.js'

const createApiHandler = service => createAuthenticatedApiHandler(service, { requestRejection: () => undefined })

function response() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(value) { this.body = value ?? '' },
  }
}

function request(method, url, body, address = '127.0.0.1') {
  const source = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() { if (source) yield Buffer.from(source) },
  }
}

test('HTTP API enforces loopback and dispatches catalog route', async () => {
  const service = { catalog: async () => ({ revision: 0, profiles: [], sessions: [] }) }
  const handler = createApiHandler(service)
  const denied = response()
  await handler(request('GET', '/prompt-presets/api/catalog', undefined, '10.0.0.2'), denied)
  assert.equal(denied.status, 403)
  const allowed = response()
  await handler(request('GET', '/prompt-presets/api/catalog'), allowed)
  assert.equal(allowed.status, 200)
  assert.equal(JSON.parse(allowed.body).ok, true)
})

test('DSH authentication rejects catalog and profile writes before service access', async () => {
  for (const status of [401, 403]) {
    for (const [method, route] of [['GET', 'catalog'], ['PUT', 'profiles/test']]) {
      const req = request(method, `/prompt-presets/api/${route}`, { profile: {}, expectedRevision: 0 })
      const handler = createAuthenticatedApiHandler({
        catalog: () => assert.fail('unauthenticated read'),
        saveProfile: () => assert.fail('unauthenticated write'),
      }, { requestRejection: candidate => { assert.equal(candidate, req); return status } })
      const res = response()
      await handler(req, res)
      assert.equal(res.status, status)
      assert.equal(JSON.parse(res.body).ok, false)
      assert.equal(res.headers['cache-control'], 'no-store')
    }
  }
})

test('HTTP handler refuses to start without the DSH authentication service', () => {
  assert.throws(() => createAuthenticatedApiHandler({}), /connection/i)
})
