import { BrowserWindow, app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PdfReportResult } from '../src/types/bridge'
import { browserLaunch, registryValue } from './browserCommand'

/**
 * Turns the report HTML the renderer built into a PDF on disk.
 *
 * Why a second window instead of printing the dashboard itself: the dashboard is a dark,
 * scrolling, animated app with live charts — printing it would produce a screenshot of a
 * screen, not a document. `reportHtml.ts` builds a separate, paginated, light-on-white
 * document, and this function renders that in a throwaway offscreen window whose only
 * job is to be printed. The visible app is never disturbed.
 *
 * The HTML goes through a temp file rather than a `data:` URL: a full report with a
 * history chart runs to well over a hundred kilobytes, and long `data:` URLs are both
 * slow to parse and capped by Chromium.
 */

/** The print window gets no preload, no Node, and nothing to navigate to. */
const PRINT_WINDOW_OPTIONS = {
  show: false,
  width: 1240,
  height: 1754,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    // The report is a static document; nothing in it needs a timer to keep running.
    backgroundThrottling: false,
  },
} as const

/** A4 with even margins, in inches — Electron's unit for `printToPDF`. */
const PAGE_MARGINS = { top: 0.5, bottom: 0.55, left: 0.5, right: 0.5 }

const FOOTER_TEMPLATE = `
  <div style="width:100%;font-size:7px;color:#8a93a3;font-family:'Segoe UI',system-ui,sans-serif;
              padding:0 12mm;display:flex;justify-content:space-between;">
    <span>HardwareFlow · Hardware-Report</span>
    <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
  </div>`

/** Chromium insists on a header template; an empty one keeps the top margin clean. */
const HEADER_TEMPLATE = '<div></div>'

/**
 * Renders `html` to a PDF in the user's Downloads folder and opens it in their browser —
 * one click, no dialog, the way a download from a web page behaves.
 *
 * `fixedPath` writes there instead and opens nothing: the self-test needs the whole chain
 * without a browser popping up on the build machine.
 */
export async function exportPdfReport(html: string, suggestedName: string, fixedPath: string | null = null): Promise<PdfReportResult> {
  const target = fixedPath ?? availablePath(app.getPath('downloads'), suggestedName)

  const scratch = path.join(os.tmpdir(), `hardwareflow-report-${randomUUID()}.html`)
  const window = new BrowserWindow(PRINT_WINDOW_OPTIONS)

  try {
    await writeFile(scratch, html, 'utf8')
    await window.loadFile(scratch)
    // `did-finish-load` fires before the layout of the last fonts settles; one frame of
    // slack avoids a first page with fallback metrics.
    await new Promise((resolve) => setTimeout(resolve, 120))

    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: PAGE_MARGINS,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
    })

    await writeFile(target, pdf)
    // Opening the finished file is the point of the export — without a dialog, a saved PDF
    // nobody sees would be a silent no-op. The browser's viewer is the one asked for; with
    // no browser found, whatever opens PDFs on this machine does.
    if (!fixedPath && !(await openInBrowser(target))) void shell.openPath(target)

    return { path: target, cancelled: false, error: null }
  } catch (cause) {
    return {
      path: null,
      cancelled: false,
      error: cause instanceof Error ? cause.message : 'Der Report konnte nicht erstellt werden.',
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
    await unlink(scratch).catch(() => {
      // The temp file is the OS's problem once we are done with it.
    })
  }
}

/** `Report.pdf`, else `Report (2).pdf`, … — like a browser download, never overwriting an earlier report. */
function availablePath(directory: string, name: string): string {
  const { name: stem, ext } = path.parse(name)
  let candidate = path.join(directory, name)
  for (let copy = 2; existsSync(candidate); copy += 1) candidate = path.join(directory, `${stem} (${copy})${ext}`)
  return candidate
}

const USER_CHOICE = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice'

function queryRegistry(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true, timeout: 5000 }, (error, stdout) =>
      resolve(error ? null : registryValue(stdout)),
    )
  })
}

/**
 * Opens the file in the browser registered for web links. Windows would hand a `.pdf` to
 * its PDF app, which is often not the browser — so the browser is looked up the way
 * Windows itself does for an https link, and started with the file's URL.
 */
async function openInBrowser(file: string): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const progId = await queryRegistry([USER_CHOICE, '/v', 'ProgId'])
  const command = progId ? await queryRegistry([`HKCR\\${progId}\\shell\\open\\command`, '/ve']) : null
  const launch = command ? browserLaunch(command, pathToFileURL(file).href) : null
  if (!launch) return false

  return new Promise((resolve) => {
    const child = spawn(launch.file, launch.args, { detached: true, stdio: 'ignore' })
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
    child.once('error', () => resolve(false))
  })
}
