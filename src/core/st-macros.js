import { diagnostic } from './diagnostics.js'

const MACRO = /\{\{([\s\S]*?)\}\}/g

function splitCommand(body) {
  const parts = body.split('::')
  return { name: parts.shift()?.trim() ?? '', args: parts }
}

function valueOf(raw, variables) {
  const value = String(raw ?? '')
  const reference = /^\{\{get(?:global)?var::([^{}]+)\}\}$/u.exec(value)
  return reference ? String(variables[reference[1]] ?? '') : value
}

export function expandMacros(input, context = {}, { strict = false } = {}) {
  const variables = { ...(context.variables || {}) }
  const diagnostics = []
  let text = String(input ?? '')
  let changed = true
  let passes = 0
  while (changed && passes < 4) {
    changed = false
    passes += 1
    text = text.replace(MACRO, (whole, body) => {
      const { name, args } = splitCommand(body)
      if (name === '//') return ''
      if (name === 'user') return String(context.user ?? '{{user}}')
      if (name === 'char') return String(context.char ?? '{{char}}')
      if (name === 'lastUserMessage' || name === 'last_user_message') return String(context.lastUserMessage ?? '')
      if (name === 'setglobalvar' || name === 'setvar' || name === 'addglobalvar') {
        const variable = String(args.shift() ?? '').trim()
        if (!variable || args.length === 0) {
          diagnostics.push(diagnostic('invalid-variable-macro', strict ? 'error' : 'warning', `${name} requires a variable name and value`))
          return whole
        }
        const value = valueOf(args.join('::'), variables)
        if (name === 'addglobalvar') variables[variable] = `${variables[variable] ?? ''}${value}`
        else variables[variable] = value
        changed = true
        return ''
      }
      if (name === 'getglobalvar' || name === 'getvar') {
        const variable = String(args[0] ?? '').trim()
        if (!variable) {
          diagnostics.push(diagnostic('invalid-variable-macro', strict ? 'error' : 'warning', `${name} requires a variable name`))
          return whole
        }
        changed = true
        return String(variables[variable] ?? '')
      }
      diagnostics.push(diagnostic('unsupported-macro', strict ? 'error' : 'warning', `unsupported macro retained: ${whole}`, '', { macro: whole }))
      return whole
    })
  }
  if (passes === 4 && MACRO.test(text)) diagnostics.push(diagnostic('macro-cycle', 'error', 'macro expansion exceeded the bounded pass limit'))
  MACRO.lastIndex = 0
  return { text, variables, diagnostics }
}

export function supportedMacro(name) {
  return new Set(['//', 'user', 'char', 'lastUserMessage', 'last_user_message', 'setglobalvar', 'setvar', 'addglobalvar', 'getglobalvar', 'getvar']).has(name)
}
