import test from 'node:test'
import assert from 'node:assert/strict'

import { contentHash } from '../src/core/canonical.js'
import { resolveLayers, validateProfile } from '../src/core/profile.js'

const entry = (id, overrides = {}) => ({ id, name: id, slot: 'pre-response', content: id, ...overrides })
const profile = (id, overrides = {}) => validateProfile({ id, name: id, entries: [], ...overrides })

test('validates unique entries and stable semantic hashes', () => {
  const source = profile('base', { entries: [entry('one')] })
  assert.throws(() => validateProfile({ ...source, entries: [entry('one'), entry('one')] }), /duplicate entry id/)
  assert.equal(contentHash({ ...source, revision: 1 }), contentHash({ ...source, revision: 99 }))
})

test('higher layer replaces entries by id and keeps explicit disabled state', () => {
  const result = resolveLayers([
    profile('base', { entries: [entry('style', { content: 'base' }), entry('world', { content: 'world' })] }),
    profile('overlay', { entries: [entry('style', { enabled: false, content: 'disabled' })] }),
  ])
  assert.equal(result.allEntries.find(item => item.id === 'style').enabled, false)
  assert.deepEqual(result.entries.map(item => item.id), ['world'])
  assert.equal(result.provenance.style.profileId, 'overlay')
})

test('reports contradictory single-selection groups', () => {
  const result = resolveLayers([profile('base', { entries: [
    entry('pov-first', { group: 'pov', selection: 'single' }),
    entry('pov-third', { group: 'pov', selection: 'single' }),
  ] })])
  assert.equal(result.diagnostics[0].code, 'single-selection-conflict')
})

test('reports an empty required group', () => {
  const result = resolveLayers([profile('base', {
    entries: [entry('pov-first', { enabled: false, group: 'pov', selection: 'single' })],
    groups: { pov: { selection: 'single', required: true } },
  })])
  assert.equal(result.diagnostics[0].code, 'required-group-empty')
})

test('requires explicit rules for hybrid POV', () => {
  assert.throws(() => profile('hybrid', { narrativeContract: { pov: 'hybrid' } }), /hybridRules/)
  assert.equal(profile('hybrid-ok', { narrativeContract: { pov: 'hybrid', hybridRules: { worldAndNpc: 'third-objective', protagonist: 'first' } } }).narrativeContract.pov, 'hybrid')
})

test('optional profiles can inherit the locked card narrative contract', () => {
  const result = resolveLayers([
    profile('card', {
      narrativeContract: {
        pov: 'hybrid',
        protagonistReference: { name: 'Test Protagonist', pronouns: ['he'], selfReference: 'I' },
        hybridRules: { worldAndNpc: 'third-objective', protagonist: 'first' },
      },
    }),
    profile('optional', {
      narrativeContractMode: 'inherit',
      entries: [entry('optional-style', { enabled: false, renderOnly: true })],
    }),
  ])

  assert.equal(result.narrativeContract.pov, 'hybrid')
  assert.equal(result.narrativeContract.protagonistReference.name, 'Test Protagonist')
  assert.deepEqual(result.narrativeContract.hybridRules, { worldAndNpc: 'third-objective', protagonist: 'first' })
  assert.equal(result.allEntries[0].renderOnly, true)
})
