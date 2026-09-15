import { spawn } from 'node:child_process'

/**
 * Startet die Electron-Binary mit einer sauberen Umgebung.
 *
 * Wichtig: Editoren, die selbst auf Electron laufen (VS Code, Antigravity), setzen
 * in ihren Terminals ELECTRON_RUN_AS_NODE=1. Erbt unsere App diese Variable, startet
 * die Binary als reines Node — `require('electron')` liefert dann nur den Pfad zur
 * Binary, und der Main-Prozess stirbt mit "Cannot read properties of undefined
 * (reading 'getAppPath')". Deshalb wird sie hier entfernt.
 */
export async function spawnElectron(args = ['.'], extraEnv = {}, stdio = 'inherit') {
  const { default: electronPath } = await import('electron')

  const env = { ...process.env, ...extraEnv }
  delete env.ELECTRON_RUN_AS_NODE

  return spawn(electronPath, args, { stdio, env })
}
