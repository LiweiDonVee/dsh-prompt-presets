import { API_PREFIX, createApiHandler } from './http.js'
import { PromptPresetService } from './service.js'
import { PromptPresetStore, resolveStoreRoot } from './store.js'

export const name = 'dsh-prompt-presets'

export function apply(ctx) {
  const service = new PromptPresetService(new PromptPresetStore(resolveStoreRoot()))
  ctx.provide('promptPresets', service)
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    webCtx.effect(() => webServer.register({ kind: 'prefix', path: API_PREFIX, handler: createApiHandler(service, webCtx.get('connection')) }), 'prompt-presets: api')
  })
}
