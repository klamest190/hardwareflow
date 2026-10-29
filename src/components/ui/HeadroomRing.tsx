import { loadColor } from '../../lib/status'
import type { Headroom } from '../../types/hardware'

/**
 * Live headroom as a compact ring: how much of the machine is free right now. The ring
 * fills with what is left, so a full ring is a relaxed machine; it stays grey until the
 * load behind it leaves its normal band.
 */
export function HeadroomRing({ headroom, size = 36 }: { headroom: Headroom; size?: number }) {
  const color = loadColor(100 - headroom.percent)
  const stroke = Math.max(3, size / 10)
  const radius = size / 2 - stroke / 2 - 0.5
  const circumference = 2 * Math.PI * radius

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - headroom.percent / 100)}
      />
    </svg>
  )
}
