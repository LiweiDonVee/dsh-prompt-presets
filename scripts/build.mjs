import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const pluginId = 'dsh-prompt-presets'

await rm(new URL('../lib', import.meta.url), { recursive: true, force: true })
await mkdir(new URL('../lib', import.meta.url), { recursive: true })

await build({
  entryPoints: [fileURLToPath(new URL('../src/host/index.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/index.js', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  sourcemap: true,
})

await build({
  entryPoints: [fileURLToPath(new URL('../src/client/index.jsx', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/client.js', import.meta.url)),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  legalComments: 'none',
  sourcemap: true,
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})

console.log('Built lib/index.js and lib/client.js')
