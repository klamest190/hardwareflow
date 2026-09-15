import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  /** Subsystem identity colour — applied to chrome only, never to text. */
  accent: string
  /**
   * `neon` gives the card an accent border, an outer bloom and a lit icon chip; the
   * four hardware modules use it. `quiet` keeps the plain hairline, so the score panel
   * does not compete with them for attention.
   */
  emphasis?: 'neon' | 'quiet'
  /** Right-hand slot of the header: a reading, a badge, a chip. */
  action?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * The single panel shell every module sits in.
 *
 * The accent hue reaches the page only as chrome — border, bloom, top rule and icon
 * chip. Labels and values stay on the ink tokens, so a saturated hue never has to
 * carry text contrast, and the card's identity colour stays readable next to the
 * status colours the meters inside it use.
 */
export function Card({
  title,
  subtitle,
  icon: Icon,
  accent,
  emphasis = 'neon',
  action,
  className = '',
  children,
}: CardProps) {
  const neon = emphasis === 'neon'

  return (
    <motion.section
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      // The hue travels to the CSS in one custom property; every accent shade is
      // derived from it in index.css rather than mixed by hand here.
      style={{ '--hf-accent': accent } as CSSProperties}
      className={`relative isolate flex flex-col overflow-hidden rounded-2xl border bg-surface ${
        neon ? 'hf-card-neon' : 'border-hairline'
      } ${className}`}
    >
      {/* Corner wash, behind the content: gives the panel a lit edge without putting
          a saturated fill under any text. */}
      {neon && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: `radial-gradient(130% 90% at 0% 0%, ${accent}17, transparent 62%)` }}
        />
      )}

      {/* Accent rule along the top edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          opacity: neon ? 1 : 0.5,
        }}
      />

      <header className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="hf-chip grid size-9 shrink-0 place-items-center rounded-xl"
            style={{ color: accent }}
          >
            <Icon size={17} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] leading-5 font-semibold text-ink">{title}</h2>
            {/*
              The hardware's own name — which processor, which card, which modules. It is
              why someone opens a system monitor, so it sits one step below the title on
              ink-2 rather than being greyed out with the captions. No `truncate` either:
              a model name cut off mid-word answers nothing, and wrapping costs one line.
            */}
            {subtitle && (
              <p className="mt-1 text-[13px] leading-4.5 font-medium wrap-break-word text-ink-2">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0 text-right">{action}</div>}
      </header>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">{children}</div>
    </motion.section>
  )
}
