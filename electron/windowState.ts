import { app, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Remembers where the window was.
 *
 * A system monitor is opened again and again; having to resize and reposition it every
 * time is the kind of friction that makes a desktop app feel like a web page in a frame.
 *
 * The saved bounds are validated against the displays actually attached, because the
 * common failure of this feature is restoring a window onto a monitor that has since
 * been unplugged — the app then opens off-screen and looks like it failed to start.
 */

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_STATE: WindowState = { width: 1600, height: 1000, maximized: false }

/** Resolved lazily: `userData` is only final once the app has its name. */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')

/** How much of the window must land on a display for the position to be reused. */
const MIN_VISIBLE_PX = 120

function isVisibleOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false

  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(state.x! + state.width, workArea.x + workArea.width) - Math.max(state.x!, workArea.x)
    const overlapY = Math.min(state.y! + state.height, workArea.y + workArea.height) - Math.max(state.y!, workArea.y)
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX
  })
}

/** Saved bounds if they still make sense on this setup, defaults otherwise. */
export function loadWindowState(): WindowState {
  let saved: Partial<WindowState>
  try {
    saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<WindowState>
  } catch {
    // No file yet, or a corrupted one — either way the defaults are correct.
    return DEFAULT_STATE
  }

  const state: WindowState = {
    width: Math.max(Math.round(saved.width ?? DEFAULT_STATE.width), 900),
    height: Math.max(Math.round(saved.height ?? DEFAULT_STATE.height), 700),
    maximized: saved.maximized === true,
    x: typeof saved.x === 'number' ? Math.round(saved.x) : undefined,
    y: typeof saved.y === 'number' ? Math.round(saved.y) : undefined,
  }

  if (!isVisibleOnSomeDisplay(state)) {
    // Keep the remembered size, let the OS place the window.
    return { width: state.width, height: state.height, maximized: state.maximized }
  }
  return state
}

/** Pixels of round-trip error tolerated before a size counts as deliberately changed. */
const RESIZE_NOISE_PX = 4

/**
 * The size to persist, given what we opened with and what the window reports now.
 *
 * On a scaled display (150 % here) Electron converts the requested size to physical
 * pixels and back, and the result is a pixel or two larger than what went in. Saved
 * verbatim that grows on every launch — measured: 1600 → 1601 → 1604 → 1608 — so the
 * window creeps across the screen over a few weeks. Differences inside the tolerance
 * are therefore treated as the same size, and only a real resize is recorded.
 */
export function settledSize(
  opened: { width: number; height: number },
  actual: { width: number; height: number },
): { width: number; height: number } {
  const unchanged =
    Math.abs(actual.width - opened.width) <= RESIZE_NOISE_PX &&
    Math.abs(actual.height - opened.height) <= RESIZE_NOISE_PX
  return unchanged ? opened : actual
}

export function saveWindowState(state: WindowState): void {
  try {
    const file = stateFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8')
  } catch {
    // Losing the window position is not worth an error on screen.
  }
}
