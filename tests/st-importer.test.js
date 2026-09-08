import test from 'node:test'
import assert from 'node:assert/strict'
import { expandMacros } from '../src/core/st-macros.js'
import { exportSillyTavern } from '../src/core/st-exporter.js'
import { importSillyTavern } from '../src/core/st-importer.js'

// Artificial structural fixture, not a third-party prompt preset.
function fixture() {
  const prompts = [
    { identifier: 'pov', name: '第一人称', content: 'TEST_POV', enabled: true },
    { identifier: 'turn', name: '转述', content: 'TEST_TURN', enabled: false },
    { identifier: 'role', name: '角色设定', content: 'TEST_ROLE', enabled: false },
    { identifier: 'charDescription', name: 'Marker', content: '', marker: true },
  ]
  return { name: 'Synthetic fixture', prompts, prompt_order: [{ character_id: 1, order: prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled !== false })) }], extensions: { regex_scripts: [{ id: 'synthetic', findRegex: '/test/g', replaceString: 'fixture' }], tavern_helper: { scripts: [{ content: 'TEST_ONLY_NOT_EXECUTED' }] } } }
}

test('imports structural fixture preserving disabled prompts, markers and extensions', () => {
  const input = fixture()
  const original = structuredClone(input)
  const result = importSillyTavern(input, { id: 'fixture-profile' })
  assert.equal(result.profile.entries.length, 4)
  assert.equal(result.profile.entries.filter(e => !e.enabled).length, 2)
  for (const group of ['pov', 'user-role', 'turn-taking']) assert.ok(result.profile.entries.some(e => e.group === group && e.selection === 'single'))
  assert.equal(result.profile.stCompat.promptOrder.length, 1)
  assert.ok(result.diagnostics.some(d => d.code === 'regex-scripts-unmigrated'))
  assert.ok(result.diagnostics.some(d => d.code === 'tavern-helper-unmigrated'))
  assert.ok(result.profile.entries.some(e => e.stCompat.originalPrompt?.identifier === 'charDescription'))
  assert.deepEqual(input, original)
})

test('bounded macros evaluate supplied variables and diagnose unsupported instructions', () => {
  const result = expandMacros('{{setglobalvar::value::test}}{{getglobalvar::value}} {{user}} {{unsupported::x}}', { user: 'Fixture' }, { strict: true })
  assert.equal(result.text, 'test Fixture {{unsupported::x}}')
  assert.ok(result.diagnostics.some(d => d.code === 'unsupported-macro' && d.severity === 'error'))
})

test('export retains normalized entries and nonexecuted extension data', () => {
  const input = fixture()
  const imported = importSillyTavern(input, { id: 'fixture-profile' })
  const result = exportSillyTavern(imported.profile).preset
  assert.equal(result.prompts.length, input.prompts.length)
  assert.equal(result.prompt_order[0].order.length, input.prompts.length)
  assert.equal(result.extensions.dsh_prompt_presets.profileId, 'fixture-profile')
  assert.deepEqual(result.extensions.regex_scripts, input.extensions.regex_scripts)
})
