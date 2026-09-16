import { useReducedMotion } from 'framer-motion'
import { Gauge } from 'lucide-react'
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts'

import { GRADE_META, loadColor } from '../lib/status'
import type { HardwareScore } from '../types/hardware'
import { AnimatedNumber } from './ui/AnimatedNumber'
import { Card } from './ui/Card'
import { Meter } from './ui/Meter'

interface PerformanceMeterProps {
  score: HardwareScore
  className?: string
}

/** 270° sweep, open at the bottom — the conventional gauge reading direction. */
const START_ANGLE = 215
const END_ANGLE = -35

/**
 * The dashboard's hero figure: one number for what this machine can do, with the
 * weighted inputs listed underneath so the score is auditable rather than magic. It
 * does not move with load — that is the header's reserve ring.
 */
export function PerformanceMeter({ score, className }: PerformanceMeterProps) {
  const meta = GRADE_META[score.grade]
  // Recharts has no equivalent of `MotionConfig`, so the arc's sweep is switched off here.
  const reducedMotion = useReducedMotion()

  return (
    <Card
      title="HardwareFlow Score"
      subtitle="Was diese Maschine kann — unabhängig von der Last"
      icon={Gauge}
      accent={meta.color}
      // Quiet on purpose: the hardware cards carry the neon accent, so the score panel
      // stays the calm anchor instead of adding a fifth glow.
      emphasis="quiet"
      className={className}
      action={
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
        >
          <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
          {meta.label}
        </span>
      }
    >
      <div className="relative mx-auto w-full max-w-[260px]">
        <ResponsiveContainer width="100%" height={168}>
          <RadialBarChart
            data={[{ name: 'score', value: score.total }]}
            innerRadius="78%"
            outerRadius="100%"
            startAngle={START_ANGLE}
            endAngle={END_ANGLE}
            barSize={14}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              angleAxisId={0}
              cornerRadius={7}
              fill={meta.color}
              background={{ fill: `${meta.color}22` }}
              isAnimationActive={!reducedMotion}
              animationDuration={600}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        {/* Hero figure, centred in the arc. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2">
          <AnimatedNumber value={score.total} className="text-[52px] leading-none font-semibold text-ink" />
          <span className="mt-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">von 100</span>
        </div>

        {/* Scale ends, so the arc is a measurement and not a decoration. */}
        <div className="absolute inset-x-1 bottom-1 flex justify-between text-[10px] font-medium text-muted tabular-nums">
          <span>0</span>
          <span>100</span>
        </div>
      </div>

      <p className="mt-1 text-center text-xs leading-5 text-ink-2">{meta.summary}</p>

      <ul className="mt-4 space-y-3 border-t border-hairline pt-4">
        {score.components.map((component) => (
          <li key={component.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium text-ink-2">{component.label}</span>
                {component.estimated && (
                  <span
                    className="shrink-0 cursor-help rounded border border-hairline px-1 text-[10px] text-muted"
                    title="Modell nicht in der Leistungstabelle — aus Threads, Takt bzw. VRAM geschätzt"
                  >
                    geschätzt
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs font-semibold text-ink tabular-nums">
                {Math.round(component.score)}
                <span className="ml-1 font-normal text-muted">× {Math.round(component.weight * 100)} %</span>
              </span>
            </div>
            <Meter
              value={component.score}
              color={loadColor(100 - component.score)}
              height={5}
              className="mt-1.5"
              ariaLabel={`${component.label}: ${Math.round(component.score)} von 100`}
            />
            <p className="mt-1 text-[11px] leading-4 text-muted">{component.detail}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
