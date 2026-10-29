import { execFile } from 'node:child_process'
import { app } from 'electron'

import type { ProgramInfo } from '../src/types/bridge'
import { isShowablePath } from './processControl'

/**
 * Human names and icons for the process list: "Google Chrome" with its icon instead of
 * `chrome`. Both come from the executable itself — the icon through the shell, the name
 * from the file's version resource (`FileDescription`), which Electron cannot read, so a
 * single PowerShell call fetches every new path at once.
 *
 * Results are cached per path for the life of the app; an executable does not rename
 * itself, and the list asks again every 15 seconds.
 */

const cache = new Map<string, ProgramInfo>()
/** Paths a lookup is already running for, so overlapping refreshes do not double up. */
const pending = new Map<string, Promise<void>>()

const DESCRIBE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = @{}
foreach ($p in $paths) { $out[$p] = (Get-Item -LiteralPath $p).VersionInfo.FileDescription }
$out | ConvertTo-Json -Compress
`

function readDescriptions(paths: string[]): Promise<Record<string, string | null>> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({})
      return
    }
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', DESCRIBE_SCRIPT],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, string | null>)
        } catch {
          resolve({})
        }
      },
    )
    child.stdin?.end(JSON.stringify(paths))
  })
}

/** A description is only worth showing when it names the program — not "?" or the exe name again. */
function usefulDescription(description: string | null | undefined): string | null {
  const text = description?.trim()
  if (!text || text.length > 60 || /^[\s?.]*$/.test(text)) return null
  return text
}

async function lookUp(paths: string[]) {
  const descriptions = await readDescriptions(paths)
  await Promise.all(
    paths.map(async (target) => {
      let icon: string | null = null
      try {
        const image = await app.getFileIcon(target, { size: 'small' })
        icon = image.isEmpty() ? null : image.toDataURL()
      } catch {
        // No icon is fine; the row falls back to the name alone.
      }
      cache.set(target, { description: usefulDescription(descriptions[target]), icon })
    }),
  )
}

/** Names and icons for the given executables. Unknown or unsafe paths are skipped. */
export async function describePrograms(paths: string[]): Promise<Record<string, ProgramInfo>> {
  const valid = [...new Set(paths)].filter((target) => typeof target === 'string' && isShowablePath(target)).slice(0, 64)
  const missing = valid.filter((target) => !cache.has(target) && !pending.has(target))

  if (missing.length > 0) {
    const job = lookUp(missing).finally(() => missing.forEach((target) => pending.delete(target)))
    missing.forEach((target) => pending.set(target, job))
  }
  await Promise.all(valid.map((target) => pending.get(target)).filter(Boolean))

  return Object.fromEntries(valid.flatMap((target) => (cache.has(target) ? [[target, cache.get(target)!]] : [])))
}
