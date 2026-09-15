import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect } from 'react'

interface AnimatedNumberProps {
  value: number
  /** Decimal places in the rendered output. */
  digits?: number
  className?: string
}

/**
 * Eases between readings instead of snapping. On a dashboard that re-renders every
 * second, snapping digits read as flicker and make the number hard to actually read.
 * The tween stays well under the 1 s tick, so the shown value never lags far behind
 * the plain-text readings beside it.
 */
export function AnimatedNumber({ value, digits = 0, className }: AnimatedNumberProps) {
  const motionValue = useMotionValue(value)
  const text = useTransform(motionValue, (latest) => latest.toFixed(digits))

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.35, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [motionValue, value])

  return <motion.span className={className}>{text}</motion.span>
}
