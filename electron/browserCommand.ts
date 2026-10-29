/**
 * Turns a browser's registered open command into something `spawn` can run. Pure, so the
 * smoke test can check it.
 *
 * Windows stores it as one string, e.g.
 *   "C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument %1
 *   "C:\Program Files\Mozilla Firefox\firefox.exe" -osint -url "%1"
 * `%1` is where the address goes; without one it is appended. Anything that does not start
 * with an absolute path to an .exe is refused — this string comes from the registry, and
 * it is only ever started without a shell.
 */
export function browserLaunch(command: string, url: string): { file: string; args: string[] } | null {
  const expanded = command.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, (whole, name: string) => process.env[name] ?? whole)
  const tokens = [...expanded.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2])
  const [file, ...rest] = tokens
  if (!file || !/^[A-Za-z]:\\.+\.exe$/i.test(file)) return null

  const hasSlot = rest.some((token) => token.includes('%1'))
  const args = rest.map((token) => token.replace('%1', url))
  return { file, args: hasSlot ? args : [...args, url] }
}

/** `ProgId    REG_SZ    ChromeHTML` → `ChromeHTML`; the default value's name is localised, so match on the type. */
export function registryValue(output: string): string | null {
  return /REG_(?:EXPAND_)?SZ\s+(.+)/.exec(output)?.[1].trim() || null
}
