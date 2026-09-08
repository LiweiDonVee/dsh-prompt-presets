export const DIAGNOSTIC_SEVERITIES = Object.freeze(['info', 'warning', 'error'])

export function diagnostic(code, severity, message, path = '', details = undefined) {
  if (!DIAGNOSTIC_SEVERITIES.includes(severity)) throw new TypeError(`invalid diagnostic severity: ${severity}`)
  return {
    code: String(code),
    severity,
    message: String(message),
    ...(path ? { path: String(path) } : {}),
    ...(details === undefined ? {} : { details }),
  }
}

export function hasErrors(diagnostics) {
  return Array.isArray(diagnostics) && diagnostics.some(item => item?.severity === 'error')
}

export function mergeDiagnostics(...lists) {
  return lists.flatMap(list => Array.isArray(list) ? list : []).map(item => ({ ...item }))
}
