import test from 'node:test'
import assert from 'node:assert/strict'

import { compileLayers } from '../src/core/compiler.js'
import { validateProfile } from '../src/core/profile.js'
import { expandMacros } from '../src/core/st-macros.js'

const entry = (id, overrides = {}) => ({ id, name: id, slot: 'pre-response', content: id, ...overrides })
const profile = (id, overrides = {}) => validateProfile({ id, name: id, entries: [], ...overrides })

test('settlement and render compilation share hash and contract', () => {
  const result = compileLayers([profile('rp', {
    narrativeContract: { pov: 'third-limited', agency: 'never-decide' },
    entries: [
      entry('world', { slot: 'world', content: '公开世界规则' }),
      entry('tool', { slot: 'pre-response', content: '工具纪律', renderSafe: false, settlementOnly: true }),
      entry('style', { slot: 'render-style', content: '文风' }),
    ],
  })])
  assert.equal(result.blocked, false)
  assert.equal(result.profileHash, compileLayers([profile('rp', {
    narrativeContract: { pov: 'third-limited', agency: 'never-decide' },
    entries: [entry('world', { slot: 'world', content: '公开世界规则' }), entry('tool', { slot: 'pre-response', content: '工具纪律', renderSafe: false, settlementOnly: true }), entry('style', { slot: 'render-style', content: '文风' })],
  })]).profileHash)
  assert.deepEqual(result.narrativeContract, result.narrativeContract)
  assert.equal(result.renderSections.some(section => section.text.includes('工具纪律')), false)
  assert.equal(result.renderSections.some(section => section.text.includes('公开世界规则')), true)
  assert.equal(result.sections[0].text.includes(result.profileHash), true)
})

test('strict compile blocks unresolved macro diagnostics', () => {
  const result = compileLayers([profile('bad', { entries: [entry('bad', { content: '{{unknown_macro}}' })] })], {
    expand: () => ({ text: '{{unknown_macro}}', diagnostics: [{ code: 'unsupported-macro', severity: 'error', message: 'unsupported' }] }),
  })
  assert.equal(result.blocked, true)
  assert.equal(result.sections.length, 0)
})

test('evaluates ST variables in normalized prompt order', () => {
  const result = compileLayers([profile('vars', { entries: [
    entry('setter', { order: 10, content: '{{setglobalvar::tone::克制}}' }),
    entry('reader', { order: 20, content: '文风={{getglobalvar::tone}}' }),
  ] })], { expand: (text, context) => expandMacros(text, context, { strict: true }) })
  assert.equal(result.entries.find(item => item.id === 'reader').content, '文风=克制')
  assert.equal(result.variables.tone, '克制')
})

test('render-only entries stay out of settlement and enter the render pass', () => {
  const result = compileLayers([profile('agent-overlay', {
    narrativeContractMode: 'inherit',
    entries: [
      entry('settlement-rule', { content: '结算纪律', renderSafe: false, settlementOnly: true }),
      entry('render-method', { slot: 'render-style', content: 'TEST_RENDER_METHOD', renderOnly: true, renderSafe: true }),
    ],
  })])

  assert.equal(result.sections.some(section => section.entryIds.includes('render-method')), false)
  assert.equal(result.renderSections.some(section => section.entryIds.includes('render-method')), true)
  assert.equal(result.renderSections.some(section => section.entryIds.includes('settlement-rule')), false)
})
