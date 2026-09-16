import fs from 'node:fs'
import path from 'node:path'
import si from 'systeminformation'

import type { KillResult } from '../src/types/bridge'
import { refusalReason } from './processPolicy'

/**
 * "Beenden" and "Speicherort öffnen" from the process page.
 *
 * The renderer asks by program name and PIDs from a list that is up to 15 seconds old,
 * so nothing is taken on trust: the name must not be protected, and every PID must
 * still belong to a process of that name right now. A reused PID therefore can never
 * take an unrelated process down with it.
 */

export async function killProcesses(name: string, pids: number[]): Promise<KillResult> {
  const refused = refusalReason(name, pids, [process.pid, process.ppid])
  if (refused) return { ended: 0, failed: [], refused }

  // Re-read the table: a PID from the page may have been reused since.
  const { list } = await si.processes()
  const current = new Map(list.map((entry) => [entry.pid, entry.name.toLowerCase()] as const))

  const result: KillResult = { ended: 0, failed: [], refused: null }
  for (const pid of pids) {
    if (current.get(pid) !== name.toLowerCase()) {
      result.failed.push({ pid, reason: 'läuft nicht mehr' })
      continue
    }
    try {
      process.kill(pid)
      result.ended += 1
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      result.failed.push({
        pid,
        reason: code === 'EPERM' ? 'keine Berechtigung (Administratorrechte nötig)' : (code ?? 'unbekannter Fehler'),
      })
    }
  }
  return result
}

/** Only an existing, absolute path to an executable — never a folder or a URL from the renderer. */
export function isShowablePath(target: string): boolean {
  return path.isAbsolute(target) && /\.exe$/i.test(target) && fs.existsSync(target)
}
