import {
  siAmd,
  siApple,
  siArm,
  siBroadcom,
  siCorsair,
  siIntel,
  siMediatek,
  siNvidia,
  siQualcomm,
  siSamsung,
  siSeagate,
  siToshiba,
  siTplink,
  type SimpleIcon,
} from 'simple-icons'

/**
 * Vendor marks, recognised from the device name the system reports. Order matters: a
 * "GeForce" on an Intel-branded laptop line is still an NVIDIA chip, so the GPU families
 * are checked before the bare vendor words.
 */
const VENDORS: Array<[RegExp, SimpleIcon]> = [
  [/nvidia|geforce|quadro|\brtx\b|\bgtx\b/i, siNvidia],
  [/\bamd\b|radeon|ryzen|threadripper|epyc|advanced micro/i, siAmd],
  [/intel|core ultra|\bxeon\b|celeron|pentium|\barc\b/i, siIntel],
  [/qualcomm|snapdragon|adreno/i, siQualcomm],
  [/\bapple\b/i, siApple],
  [/mediatek/i, siMediatek],
  [/broadcom/i, siBroadcom],
  [/samsung/i, siSamsung],
  [/seagate/i, siSeagate],
  [/toshiba/i, siToshiba],
  [/corsair/i, siCorsair],
  [/tp-?link/i, siTplink],
  [/\barm\b|cortex/i, siArm],
]

/** The mark of the vendor named in a device string, or `null` when none is recognised. */
export function vendorIcon(name: string): SimpleIcon | null {
  return VENDORS.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

/** The sticker the marks sit on — a warm paper white, like the vendor badge on a notebook. */
export const BADGE = '#f4f2ee'

/** Relative luminance of a `RRGGBB` colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** The brand colour, unless it nearly vanishes on the badge — then the housing graphite. */
export function brandFill(hex: string): string {
  const contrast = (luminance(BADGE.slice(1)) + 0.05) / (luminance(hex) + 0.05)
  return contrast < 2 ? '#1e2124' : `#${hex}`
}
