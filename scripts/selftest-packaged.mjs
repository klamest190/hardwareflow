/**
 * Selbsttest der gepackten App: startet release/win-unpacked/HardwareFlow.exe mit
 * denselben Prüfungen wie selftest:app, plus Autostart, der nur installiert geht.
 * Aufruf: npm run package && npm run selftest:packaged
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const exe = join('release', 'win-unpacked', 'HardwareFlow.exe')
if (!existsSync(exe)) {
  console.error(`${exe} fehlt — zuerst "npm run package" ausführen.`)
  process.exit(1)
}

const env = { ...process.env, HARDWAREFLOW_SELFTEST: '1', HARDWAREFLOW_EXPECT_PACKAGED: '1' }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(exe, [], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code ?? 1))
