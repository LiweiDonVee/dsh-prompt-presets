import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

// Materialize the actual client entry without mounting React or contacting a host.
async function loadClient() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/index.jsx', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'browser',
    jsx: 'automatic', loader: { '.css': 'text' }, packages: 'external',
  })
  const module = { exports: {} }
  const jsx = (type, props) => ({ type, props })
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  }
  runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, document,
    require: id => {
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
      throw new Error(`Unexpected external module: ${id}`)
    },
  })
  return module.exports
}

function context() {
  const seats = new Map()
  const remote = { agentPresets: {}, settings: {} }
  const t = key => key
  const ctx = {
    remote,
    get: key => { assert.equal(key, 'remote'); return remote },
    effect: setup => setup(),
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, register) => register(),
      register: (options, render) => { seats.set(options.name, { options, render }); return () => {} },
    },
  }
  return { ctx, seats, t, remote }
}

test('settings and session dock consume the rc.2 slot owner props', async () => {
  const client = await loadClient()
  const { ctx, seats, t } = context()
  client.apply(ctx)
  assert.equal(seats.has('settings.section'), false)
  assert.equal(seats.get('settings.plugins.tab').render({}).props.t, t)
  const dock = seats.get('conversation.input.dock')
  const element = dock.render({ session: { sessionId: 'session-current' }, input: {}, t })
  assert.equal(element.props.sessionId, 'session-current')
  assert.equal(element.props.t, t)
})
