interface NotAvailableProps {
  /** What exactly is missing — shown on hover. */
  reason?: string
}

/**
 * Stands in for a value the platform does not report. Deliberately a visible marker
 * rather than a hidden row: "Windows liefert das nicht" is information, an empty gap
 * looks like a bug.
 */
export function NotAvailable({ reason = 'Wird von diesem System nicht bereitgestellt' }: NotAvailableProps) {
  return (
    <span className="cursor-help font-normal text-muted" title={reason}>
      n/v
    </span>
  )
}
