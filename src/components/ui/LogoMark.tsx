/**
 * The HardwareFlow mark: three channel strips, one of them flagged. It is the app's idea in
 * one picture — readings stay neutral until one leaves its band. Same artwork as the app
 * icon in `scripts/make-icon.mjs`.
 */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="7" width="15" height="4" rx="1" fill="#e6e3dc" />
      <rect x="4" y="14" width="24" height="4" rx="1" fill="#f2a93b" />
      <rect x="4" y="21" width="10" height="4" rx="1" fill="#e6e3dc" />
    </svg>
  )
}
