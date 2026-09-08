import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBlankProfile } from '../src/core/blank-profile.js'
import { PromptPresetService } from '../src/host/service.js'
import { PromptPresetStore } from '../src/host/store.js'

test('fresh catalog has zero profiles and creates no data until the user saves', async t => {
  const root = await mkdtemp(join(tmpdir(), 'empty-prompt-framework-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = new PromptPresetService(new PromptPresetStore(root))
  const catalog = await service.catalog()
  assert.deepEqual(catalog.profiles, [])
  assert.deepEqual(catalog.sessions, [])
  assert.deepEqual(await readdir(root), [])
  const blank = createBlankProfile('user-profile')
  assert.deepEqual(blank.entries, [])
  assert.deepEqual(blank.variables, {})
  assert.equal(blank.narrativeContract.protagonistReference.name, '')
  await service.saveProfile(blank, catalog.revision)
  assert.deepEqual((await service.getProfile(blank.id)).entries, [])
  assert.equal((await service.catalog()).profiles.length, 1)
  assert.throws(() => createBlankProfile('../outside'), /must match/)
})

test('published host does not seed content and package lists no seed directory', async () => {
  const root = new URL('../', import.meta.url)
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.ok(!pkg.files.includes('seed-profiles'))
  assert.doesNotMatch(await readFile(new URL('src/host/index.js', root), 'utf8'), /seedDirectory|seed-profiles/)
  assert.match(await readFile(new URL('src/client/PromptPresets.jsx', root), 'utf8'), /onClick=\{createProfile\}/)
})
