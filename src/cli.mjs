import { pathToFileURL } from 'node:url'

/** True when the module at importMetaUrl was started directly as a script. */
export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  try { return importMetaUrl === pathToFileURL(argv1).href } catch { return false }
}
