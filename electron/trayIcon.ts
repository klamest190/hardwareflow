import { loadColor } from '../src/lib/status'

/**
 * The tray icon as a live gauge: two bars, CPU and RAM, filled to their load and
 * coloured by the status palette. Drawn into a 32 × 32 BGRA raster (the byte order
 * `nativeImage.createFromBitmap` expects on Windows) and shown at scale factor 2, so it
 * stays sharp on the 150 % displays notebooks usually run.
 *
 * Pure: no Electron import, so the pixels can be checked in a test.
 */

export const TRAY_ICON_SIZE = 32

const PLATE = [0x14, 0x16, 0x1c] as const
const TRACK = [0x2b, 0x30, 0x3b] as const

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export function renderTrayIcon(cpuPercent: number, memoryPercent: number): Buffer {
  const size = TRAY_ICON_SIZE
  const buffer = Buffer.alloc(size * size * 4)

  const paint = (x: number, y: number, [r, g, b]: readonly [number, number, number]) => {
    const offset = (y * size + x) * 4
    buffer[offset] = b
    buffer[offset + 1] = g
    buffer[offset + 2] = r
    buffer[offset + 3] = 0xff
  }

  // Rounded plate, so the bars read on light and dark taskbars alike.
  const radius = 6
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0)
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0)
      if (dx * dx + dy * dy <= radius * radius) paint(x, y, PLATE)
    }
  }

  const bar = (left: number, percent: number) => {
    const top = 5
    const bottom = size - 5
    const height = bottom - top
    const clamped = Math.min(100, Math.max(0, percent))
    // At least two pixels, so an idle machine still shows that the gauge is alive.
    const filled = Math.max(2, Math.round((clamped / 100) * height))
    const color = hexToRgb(loadColor(clamped))
    for (let y = top; y < bottom; y += 1) {
      const lit = y >= bottom - filled
      for (let x = left; x < left + 8; x += 1) paint(x, y, lit ? color : TRACK)
    }
  }

  bar(6, cpuPercent)
  bar(18, memoryPercent)
  return buffer
}
