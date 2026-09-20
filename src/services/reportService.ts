import { buildReportHtml, reportFileName, type ReportInput } from '../lib/reportHtml'

/**
 * Exports the hardware report as a PDF.
 *
 * Two routes, because the app runs in two shells:
 *
 * - **Desktop.** The document goes to the main process, which prints it to PDF in an
 *   offscreen window and asks where to save it. That is a real PDF, paginated, with
 *   page numbers — no print dialog in the way.
 * - **Browser.** Nothing there may write a file, so the report opens in a tab and the
 *   browser's own print dialog does the rest ("Als PDF speichern"). The document is the
 *   same one either way; only who turns it into a file differs.
 */

export type ReportExportStatus = 'saved' | 'cancelled' | 'printing' | 'error'

export interface ReportExport {
  status: ReportExportStatus
  /** Where it landed, in the desktop app. */
  path: string | null
  /** A sentence for the user; `null` when nothing needs saying. */
  message: string | null
}

export async function exportReport(input: ReportInput): Promise<ReportExport> {
  const html = buildReportHtml(input)
  const fileName = reportFileName(input.snapshot)
  const bridge = window.hardwareflow

  if (bridge) {
    const result = await bridge.exportPdfReport(html, fileName)
    if (result.cancelled) return { status: 'cancelled', path: null, message: null }
    if (result.error) return { status: 'error', path: null, message: result.error }
    return { status: 'saved', path: result.path, message: `Gespeichert: ${result.path}` }
  }

  return printInBrowser(html)
}

/**
 * Browser fallback: the report in its own tab, with the print dialog already open.
 *
 * A blob URL rather than `document.write` — the latter is deprecated, and a blob keeps
 * the tab reloadable if the user wants a second look before printing.
 */
function printInBrowser(html: string): ReportExport {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const tab = window.open(url, '_blank')

  if (!tab) {
    URL.revokeObjectURL(url)
    return {
      status: 'error',
      path: null,
      message: 'Der Browser hat das Report-Fenster blockiert — bitte Pop-ups für diese Seite erlauben.',
    }
  }

  tab.addEventListener('load', () => {
    tab.focus()
    tab.print()
    // Revoking straight away would pull the document out from under the print preview.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  })

  return {
    status: 'printing',
    path: null,
    message: 'Report geöffnet — im Druckdialog „Als PDF speichern“ wählen.',
  }
}
