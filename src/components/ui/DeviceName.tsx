import { BADGE, brandFill, vendorIcon } from '../../lib/vendors'

/**
 * A vendor's mark in its own colour, on a small light badge. The badge is what keeps it
 * legible (Intel blue on graphite would not be) and what sets it apart from the status
 * colours: a coloured mark on a sticker reads as a logo, never as a reading. The name next
 * to it says the same in words, so the mark is decorative to a screen reader.
 *
 * `badge={false}` draws the bare mark, for a container that is already the badge.
 */
export function VendorLogo({ name, size = 14, badge = true }: { name: string; size?: number; badge?: boolean }) {
  const icon = vendorIcon(name)
  if (!icon) return null

  const mark = (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0" fill={brandFill(icon.hex)}>
      <path d={icon.path} />
    </svg>
  )
  if (!badge) return mark

  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-[4px] px-1" style={{ backgroundColor: BADGE }}>
      {mark}
    </span>
  )
}

/**
 * A device name with its vendor's mark in front, where the vendor is recognised. Truncates
 * by default for tight rows; `wrap` lets a panel subtitle break instead, because a model
 * name cut off mid-word answers nothing.
 */
export function DeviceName({ name, wrap = false, className = '' }: { name: string; wrap?: boolean; className?: string }) {
  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-2 align-middle ${className}`}>
      <VendorLogo name={name} size={wrap ? 20 : 18} />
      <span className={wrap ? 'min-w-0 wrap-break-word' : 'min-w-0 truncate'} title={name}>
        {name}
      </span>
    </span>
  )
}
