import test from 'node:test'
import assert from 'node:assert/strict'

import { ClientApiError, loadCatalog, revertSessionToCardDefault, saveSessionOverlay } from '../src/client/api.js'

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body }
}

test('client reads catalog and sends next-turn session overlay payload', async () => {
  const calls = []
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return response(200, { ok: true, revision: 3, profiles: [] }) }
  assert.equal((await loadCatalog(fetchImpl)).revision, 3)
  await saveSessionOverlay('s 1', { disabledEntries: ['x'] }, ['base'], 3, fetchImpl)
  assert.equal(calls[1].url.includes('s%201'), true)
  assert.deepEqual(JSON.parse(calls[1].options.body), { overlay: { disabledEntries: ['x'] }, profileIds: ['base'], expectedRevision: 3 })
  await revertSessionToCardDefault('s 1', 4, fetchImpl)
  assert.deepEqual(JSON.parse(calls[2].options.body), { expectedRevision: 4, revertToCardDefault: true })
})

test('client surfaces revision conflicts', async () => {
  const fetchImpl = async () => response(409, { ok: false, error: 'conflict', currentRevision: 9 })
  await assert.rejects(() => loadCatalog(fetchImpl), error => error instanceof ClientApiError && error.status === 409 && error.details.currentRevision === 9)
})
