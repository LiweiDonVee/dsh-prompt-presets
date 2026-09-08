import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PromptPresetService } from '../src/host/service.js'
import { PromptPresetStore } from '../src/host/store.js'
import { validateProfile } from '../src/core/profile.js'

test('service compiles settlement and render from one manifest/profile hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  await store.saveProfile(validateProfile({ id: 'base', name: 'Base', entries: [
    { id: 'world', slot: 'world', content: 'world' },
    { id: 'tool', slot: 'pre-response', content: 'tool', renderSafe: false, settlementOnly: true },
  ] }), 0)
  const manifestPath = path.join(root, 'prompt-manifest.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, baseProfiles: ['base'] }))
  const service = new PromptPresetService(store)
  const compiled = await service.compileForAgent({ manifestPath, sessionId: 'session-a' })
  const render = await service.compileForRender({ manifestPath, sessionId: 'session-a' })
  assert.equal(compiled.blocked, false)
  assert.equal(compiled.profileHash, render.profileHash)
  assert.equal(render.sections.some(section => section.text.includes('tool')), false)
})

test('entry-only session overlays preserve the card narrative contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  await store.saveProfile(validateProfile({
    id: 'card',
    name: 'Card',
    entries: [{ id: 'world', slot: 'world', content: 'world' }],
    narrativeContract: {
      pov: 'hybrid',
      protagonistReference: { name: 'Test Protagonist', pronouns: ['he'], selfReference: 'I' },
      hybridRules: { worldAndNpc: 'third-objective', protagonist: 'first' },
    },
  }), 0)
  const manifestPath = path.join(root, 'prompt-manifest.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, cardProfiles: ['card'] }))
  const service = new PromptPresetService(store)
  const initial = await service.compileForAgent({ manifestPath, sessionId: 'session-contract' })
  await service.setSessionOverlay('session-contract', { disabledEntries: ['world'] }, initial.revision, ['card'])
  const nextTurn = await service.compileForAgent({ manifestPath, sessionId: 'session-contract' })
  const render = await service.compileForRender({ manifestPath, sessionId: 'session-contract' })

  assert.equal(nextTurn.narrativeContract.pov, 'hybrid')
  assert.equal(nextTurn.narrativeContract.protagonistReference.name, 'Test Protagonist')
  assert.deepEqual(nextTurn.narrativeContract.hybridRules, { worldAndNpc: 'third-objective', protagonist: 'first' })
  assert.equal(render.profileHash, nextTurn.profileHash)
  assert.deepEqual(render.narrativeContract, nextTurn.narrativeContract)
})

test('session bindings pin exact profile versions and fail visibly when one is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  await store.saveProfile(validateProfile({ id: 'card', name: 'Card', entries: [{ id: 'world', slot: 'world', content: 'v1' }] }), 0)
  const manifestPath = path.join(root, 'prompt-manifest.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, cardProfiles: ['card'] }))
  const service = new PromptPresetService(store)
  const first = await service.compileForAgent({ manifestPath, sessionId: 'session-pinned' })
  await store.saveProfile(validateProfile({ id: 'card', name: 'Card', entries: [{ id: 'world', slot: 'world', content: 'v2' }] }), first.revision)

  const resumed = await service.compileForAgent({ manifestPath, sessionId: 'session-pinned' })
  const fresh = await service.compileForAgent({ manifestPath, sessionId: 'session-fresh' })
  assert.equal(resumed.entries.find(entry => entry.id === 'world').content, 'v1')
  assert.equal(resumed.profileRefs[0].version, 1)
  assert.equal(fresh.entries.find(entry => entry.id === 'world').content, 'v2')
  assert.equal(fresh.profileRefs[0].version, 2)

  await rm(path.join(root, 'profiles', 'card', 'v1.json'))
  const degraded = await service.compileForAgent({ manifestPath, sessionId: 'session-pinned' })
  assert.equal(degraded.blocked, true)
  assert.equal(degraded.sections.length, 0)
  assert.equal(degraded.diagnostics.some(item => item.code === 'missing-profile-version' && item.severity === 'error'), true)
})

test('forks inherit an independent binding and card-default reset removes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-prompt-presets-'))
  const store = new PromptPresetStore(root)
  await store.saveProfile(validateProfile({ id: 'card', name: 'Card', entries: [{ id: 'world', slot: 'world', content: 'world' }] }), 0)
  const manifestPath = path.join(root, 'prompt-manifest.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, cardProfiles: ['card'] }))
  const service = new PromptPresetService(store)
  const parent = await service.compileForAgent({ manifestPath, sessionId: 'parent' })
  const changed = await service.setSessionOverlay('parent', { disabledEntries: ['world'] }, parent.revision, ['card'])
  const inherited = await service.compileForAgent({ manifestPath, sessionId: 'child', parentSessionId: 'parent' })

  assert.equal(inherited.entries.some(entry => entry.id === 'world'), false)
  assert.equal(inherited.binding.inheritedFrom, 'parent')
  const childChanged = await service.setSessionOverlay('child', { enabledEntries: ['world'] }, inherited.revision, ['card'])
  const child = await service.compileForAgent({ manifestPath, sessionId: 'child' })
  const parentEffective = await service.sessionEffective('parent')
  assert.equal(child.entries.some(entry => entry.id === 'world'), true)
  assert.equal(parentEffective.compiled.entries.some(entry => entry.id === 'world'), false)

  await service.revertSessionToCardDefault('child', childChanged.state.revision)
  assert.equal(await store.sessionBinding('child'), undefined)
  const restored = await service.compileForAgent({ manifestPath, sessionId: 'child' })
  assert.equal(restored.entries.some(entry => entry.id === 'world'), true)
  assert.equal(restored.binding.inheritedFrom, undefined)
  assert.equal(changed.binding.profileRefs[0].version, 1)
})
