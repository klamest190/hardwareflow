import { BrowserWindow, app, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { PdfReportResult } from '../src/types/bridge'

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
 * Renders `html` to a PDF and asks the user where to put it.
 *
 * `parent` is the window the export was triggered from, so the save dialog is modal to
 * it instead of floating free. `fixedPath` skips the dialog and writes straight there —
 * the self-test needs the whole chain without a modal nobody can click.
 */
export async function exportPdfReport(
  html: string,
  suggestedName: string,
  parent: BrowserWindow | null,
  fixedPath: string | null = null,
): Promise<PdfReportResult> {
  const target = fixedPath ?? (await askWhereToSave(suggestedName, parent))
  if (!target) return { path: null, cancelled: true, error: null }

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
    // Opening the finished file is the point of the export — a saved PDF nobody looks at
    // is a silent no-op to the user. The self-test, which chose the path itself, does not
    // want a PDF viewer opening on the build machine.
    if (!fixedPath) void shell.openPath(target)

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

async function askWhereToSave(suggestedName: string, parent: BrowserWindow | null): Promise<string | null> {
  const defaultPath = path.join(app.getPath('documents'), suggestedName)
  const options = {
    title: 'Hardware-Report speichern',
    defaultPath,
    filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
    properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const],
  }

  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  return result.canceled || !result.filePath ? null : result.filePath
}
