/** Which kill requests are refused outright. Pure, so the smoke test can check it. */

/**
 * Processes Windows cannot run without, plus the ones whose loss logs the user out or
 * blanks the screen. Ending them is refused outright rather than left to fail — some
 * would succeed for an administrator.
 */
const PROTECTED = new Set(
  [
    'system',
    'registry',
    'memory compression',
    'secure system',
    'smss.exe',
    'csrss.exe',
    'wininit.exe',
    'winlogon.exe',
    'services.exe',
    'lsass.exe',
    'lsaiso.exe',
    'svchost.exe',
    'dwm.exe',
    'fontdrvhost.exe',
    'explorer.exe',
    'msmpeng.exe',
  ].map((name) => name.toLowerCase()),
)

/** Why a kill request is refused before any process is touched; `null` when it may proceed. */
export function refusalReason(name: string, pids: number[], ownPids: number[]): string | null {
  if (PROTECTED.has(name.trim().toLowerCase())) {
    return `${name} ist ein Windows-Systemprozess und wird nicht beendet.`
  }
  if (pids.length === 0 || !pids.every((pid) => Number.isInteger(pid) && pid > 4)) {
    return 'Ungültige Prozess-IDs.'
  }
  if (pids.some((pid) => ownPids.includes(pid))) {
    return 'HardwareFlow beendet sich nicht selbst — dafür das Tray-Menü nutzen.'
  }
  return null
}
