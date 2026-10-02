// Production bundlers resolve schema.js to schema.ts. Node's test runner needs the same mapping.
import { access } from 'node:fs/promises'
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context) }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.endsWith('.js') || !specifier.startsWith('.')) throw error
    const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
    try { await access(url) } catch { throw error }
    return nextResolve(url.href, context)
  }
}
