import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PromptPresetStore, RevisionConflictError } from '../src/host/store.js'
import { validateProfile } from '../src/core/profile.js'

const profile = (id, content = id) => validateProfile({ id, name: id, entries: [{ id: `${id}-entry`, slot: 'world', content }] })

test('store saves profiles with atomic versioned CAS and reads catalog', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  const first = await store.saveProfile(profile('base'), 0)
  assert.equal(first.profile.version, 1)
  assert.equal((await store.listProfiles()).length, 1)
  const second = await store.saveProfile(profile('base', 'changed'), first.state.revision)
  assert.equal(second.profile.version, 2)
  assert.equal((await store.readProfile('base')).entries[0].content, 'changed')
  await assert.rejects(() => store.saveProfile(profile('other'), 0), RevisionConflictError)
  const state = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'))
  assert.equal(state.profiles.base.version, 2)
})

test('session overlay is a next-turn binding and does not create session files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  const result = await store.saveSessionBinding('session-1', { profileIds: ['base'], overlay: { disabledEntries: ['x'] }, appliesFromNextTurn: true }, 0)
  assert.equal((await store.sessionBinding('session-1')).appliesFromNextTurn, true)
  assert.equal(result.state.sessions['session-1'].profileIds[0], 'base')
  assert.equal((await store.readState()).sessions['session-1'].overlay.disabledEntries[0], 'x')
})
