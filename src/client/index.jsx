import React from 'react'

import { PromptPresets, PromptSessionDock } from './PromptPresets.jsx'
import { IconLibrary } from './icons.jsx'
import { en, LOCALE_NS, zh } from './locales.js'
import styles from './styles.css'
import responsiveStyles from './responsive.css'

export const inject = ['slots', 'locale']

export function apply(ctx) {
  document.querySelector('style[data-plugin="dsh-prompt-presets"]')?.remove()
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-prompt-presets'
  style.textContent = `${styles}\n${responsiveStyles}`
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'prompt-presets: styles')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'prompt-presets: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'prompt-presets', order: 30, label: () => t('nav'), locale: LOCALE_NS }, () => <PromptPresets t={t} />)), 'prompt-presets: settings page')
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'prompt-presets', order: 16, label: () => t('session'), locale: LOCALE_NS }, ({ session, t: translate }) => <PromptSessionDock sessionId={session.id} t={translate} />)), 'prompt-presets: session drawer')
}
