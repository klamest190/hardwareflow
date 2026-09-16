/**
 * Performance classes for known processors and graphics chips.
 *
 * Thread count and VRAM say little about speed: an 8-core Ryzen 7 9800X3D beats a
 * 24-thread Xeon from 2017, and a Radeon 890M is no Intel UHD even though both are
 * "integrated". So the HardwareFlow score looks the chip up here first and only falls back to
 * a formula for models the table does not know.
 *
 * The figures are rounded multi-thread CPU and 3D GPU indices on a PassMark-like
 * scale. They are guide values for ranking machines against each other, not
 * measurements of this particular unit — cooling and power limits move a real
 * notebook by ±15 %. More specific patterns come first, so `7950x3d` wins over
 * `7950x` and `4070 ti super` over `4070 ti`.
 */

export interface BenchmarkMatch {
  index: number
  /** The table entry that matched, for the detail line. */
  label: string
}

type Entry = [pattern: RegExp, index: number, label: string]

/**
 * Lower-cases and strips what vendors wrap around the actual model: legal marks,
 * "CPU @ 3.60GHz", "with Radeon Graphics", and hyphens (`i7-13700H` → `i7 13700h`).
 */
export function normalizeModel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\((?:r|tm|c)\)|[®™©]/g, ' ')
    .replace(/@.*$/, ' ')
    .replace(/\b(?:cpu|processor|with radeon graphics|w\/ radeon graphics|\d+-core)\b/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CPUS: Entry[] = [
  // Intel Core Ultra (desktop and mobile)
  [/ultra 9 285k/, 67_000, 'Core Ultra 9 285K'],
  [/ultra 7 265k/, 59_000, 'Core Ultra 7 265K'],
  [/ultra 5 245k/, 42_000, 'Core Ultra 5 245K'],
  [/ultra 9 275hx/, 52_000, 'Core Ultra 9 275HX'],
  [/ultra 9 285h\b/, 33_000, 'Core Ultra 9 285H'],
  [/ultra 7 255h\b/, 29_000, 'Core Ultra 7 255H'],
  [/ultra 9 185h\b/, 29_000, 'Core Ultra 9 185H'],
  [/ultra 7 165h\b/, 26_000, 'Core Ultra 7 165H'],
  [/ultra 7 155h\b/, 25_000, 'Core Ultra 7 155H'],
  [/ultra 5 125h\b/, 21_500, 'Core Ultra 5 125H'],
  [/ultra 7 1[56]5u\b/, 15_000, 'Core Ultra 7 U'],
  [/ultra 5 1[23]5u\b/, 13_500, 'Core Ultra 5 U'],
  [/ultra 7 2[56]8v\b/, 19_000, 'Core Ultra 7 V'],
  [/ultra 5 22[68]v\b/, 16_500, 'Core Ultra 5 V'],
  // Intel Core, 12th–14th generation
  [/i9 1[34]900k/, 60_000, 'Core i9-13/14900K'],
  [/i7 14700k/, 53_000, 'Core i7-14700K'],
  [/i7 13700k/, 46_000, 'Core i7-13700K'],
  [/i5 1[34]600k/, 38_500, 'Core i5-13/14600K'],
  [/i5 1[34]400/, 25_000, 'Core i5-13/14400'],
  [/i3 1[34]100/, 15_000, 'Core i3-13/14100'],
  [/i9 12900k/, 41_000, 'Core i9-12900K'],
  [/i7 12700k/, 34_500, 'Core i7-12700K'],
  [/i5 12600k/, 27_500, 'Core i5-12600K'],
  [/i5 12400/, 19_500, 'Core i5-12400'],
  [/i9 1[34]9[0-9]0hx/, 46_000, 'Core i9-13/14900HX'],
  [/i7 1[34]650hx/, 34_000, 'Core i7-13/14650HX'],
  [/i7 13700h\b/, 27_500, 'Core i7-13700H'],
  [/i7 12700h\b/, 25_500, 'Core i7-12700H'],
  [/i5 1[23]500h\b/, 21_500, 'Core i5-12/13500H'],
  [/i7 1[23][56]5u\b/, 14_000, 'Core i7-12/13 U'],
  [/i5 1[23][34]5u\b/, 13_500, 'Core i5-12/13 U'],
  // Intel Core, older
  [/i9 11900k/, 25_500, 'Core i9-11900K'],
  [/i7 11800h\b/, 21_000, 'Core i7-11800H'],
  [/i7 10700k?\b/, 19_500, 'Core i7-10700'],
  [/i9 9900k/, 18_500, 'Core i9-9900K'],
  [/i7 9700k?\b/, 14_500, 'Core i7-9700'],
  [/i7 8700k?\b/, 13_800, 'Core i7-8700'],
  [/i5 10400/, 12_000, 'Core i5-10400'],
  [/i7 1165g7/, 10_500, 'Core i7-1165G7'],
  [/i5 1135g7/, 10_000, 'Core i5-1135G7'],
  [/i5 8400/, 9_300, 'Core i5-8400'],
  [/i7 8[56]50u/, 6_500, 'Core i7-8. Gen U'],
  [/i5 8[23]50u/, 6_000, 'Core i5-8. Gen U'],
  // AMD Ryzen desktop
  [/ryzen 9 9950x3d/, 70_000, 'Ryzen 9 9950X3D'],
  [/ryzen 9 9950x/, 66_000, 'Ryzen 9 9950X'],
  [/ryzen 9 7950x3d/, 62_000, 'Ryzen 9 7950X3D'],
  [/ryzen 9 7950x/, 63_000, 'Ryzen 9 7950X'],
  [/ryzen 9 9900x3d/, 55_000, 'Ryzen 9 9900X3D'],
  [/ryzen 9 9900x/, 54_000, 'Ryzen 9 9900X'],
  [/ryzen 9 7900x3d/, 50_000, 'Ryzen 9 7900X3D'],
  [/ryzen 9 7900x?\b/, 51_000, 'Ryzen 9 7900X'],
  [/ryzen 7 9800x3d/, 35_000, 'Ryzen 7 9800X3D'],
  [/ryzen 7 7800x3d/, 34_000, 'Ryzen 7 7800X3D'],
  [/ryzen 7 9700x/, 37_000, 'Ryzen 7 9700X'],
  [/ryzen 7 7700x?\b/, 36_000, 'Ryzen 7 7700X'],
  [/ryzen 5 9600x?\b/, 30_000, 'Ryzen 5 9600X'],
  [/ryzen 5 7600x?\b/, 28_500, 'Ryzen 5 7600X'],
  [/ryzen 9 5950x/, 46_000, 'Ryzen 9 5950X'],
  [/ryzen 9 5900x/, 39_000, 'Ryzen 9 5900X'],
  [/ryzen 7 5800x3d/, 28_000, 'Ryzen 7 5800X3D'],
  [/ryzen 7 5800x?\b/, 28_000, 'Ryzen 7 5800X'],
  [/ryzen 7 5700x?\b/, 26_500, 'Ryzen 7 5700X'],
  [/ryzen 5 5600x?\b/, 22_000, 'Ryzen 5 5600X'],
  [/ryzen 9 3950x/, 39_000, 'Ryzen 9 3950X'],
  [/ryzen 9 3900x?\b/, 32_000, 'Ryzen 9 3900X'],
  [/ryzen 7 3700x/, 22_500, 'Ryzen 7 3700X'],
  [/ryzen 5 3600x?\b/, 17_500, 'Ryzen 5 3600'],
  [/ryzen 5 2600x?\b/, 13_300, 'Ryzen 5 2600'],
  [/threadripper 7980x/, 150_000, 'Threadripper 7980X'],
  [/threadripper 7970x/, 110_000, 'Threadripper 7970X'],
  [/threadripper 7960x/, 80_000, 'Threadripper 7960X'],
  // AMD Ryzen mobile
  [/ryzen ai 9 hx 3[79]0/, 34_000, 'Ryzen AI 9 HX 370'],
  [/ryzen ai 9 365/, 29_000, 'Ryzen AI 9 365'],
  [/ryzen ai 7 350/, 25_000, 'Ryzen AI 7 350'],
  [/ryzen 9 [79]9[45]5hx/, 55_000, 'Ryzen 9 7945HX'],
  [/ryzen 9 [78]945hs/, 30_000, 'Ryzen 9 8945HS'],
  [/ryzen 7 [78][84]4[05]hs/, 29_000, 'Ryzen 7 7840/8845HS'],
  [/ryzen 5 [78]6[64]0hs/, 23_500, 'Ryzen 5 7640/8640HS'],
  [/ryzen 7 6800h/, 23_500, 'Ryzen 7 6800H'],
  [/ryzen 7 5800h/, 21_000, 'Ryzen 7 5800H'],
  [/ryzen 5 5600h/, 17_000, 'Ryzen 5 5600H'],
  [/ryzen 7 7730u/, 16_500, 'Ryzen 7 7730U'],
  [/ryzen 5 7530u/, 16_000, 'Ryzen 5 7530U'],
  [/ryzen 5 5500u/, 13_000, 'Ryzen 5 5500U'],
  // Apple silicon
  [/apple m4 max/, 48_000, 'Apple M4 Max'],
  [/apple m4 pro/, 38_000, 'Apple M4 Pro'],
  [/apple m4\b/, 25_000, 'Apple M4'],
  [/apple m3 max/, 38_000, 'Apple M3 Max'],
  [/apple m3 pro/, 26_500, 'Apple M3 Pro'],
  [/apple m3\b/, 19_000, 'Apple M3'],
  [/apple m2 (?:max|pro)/, 26_000, 'Apple M2 Pro/Max'],
  [/apple m2\b/, 15_500, 'Apple M2'],
  [/apple m1 (?:max|pro)/, 22_000, 'Apple M1 Pro/Max'],
  [/apple m1\b/, 14_500, 'Apple M1'],
]

const GPUS: Entry[] = [
  // NVIDIA desktop
  [/rtx 5090(?! laptop)/, 44_000, 'GeForce RTX 5090'],
  [/rtx 5080(?! laptop)/, 36_500, 'GeForce RTX 5080'],
  [/rtx 5070 ti(?! laptop)/, 32_500, 'GeForce RTX 5070 Ti'],
  [/rtx 5070(?! laptop)/, 28_500, 'GeForce RTX 5070'],
  [/rtx 5060 ti(?! laptop)/, 24_000, 'GeForce RTX 5060 Ti'],
  [/rtx 4090(?! laptop)/, 38_000, 'GeForce RTX 4090'],
  [/rtx 4080(?! laptop)/, 34_700, 'GeForce RTX 4080'],
  [/rtx 4070 ti super(?! laptop)/, 31_500, 'GeForce RTX 4070 Ti SUPER'],
  [/rtx 4070 ti(?! laptop)/, 31_000, 'GeForce RTX 4070 Ti'],
  [/rtx 4070 super(?! laptop)/, 30_000, 'GeForce RTX 4070 SUPER'],
  [/rtx 4070(?! laptop)/, 27_000, 'GeForce RTX 4070'],
  [/rtx 4060 ti(?! laptop)/, 22_500, 'GeForce RTX 4060 Ti'],
  [/rtx 4060(?! laptop)/, 19_800, 'GeForce RTX 4060'],
  [/rtx 3090(?! laptop)/, 26_500, 'GeForce RTX 3090'],
  [/rtx 3080(?! laptop)/, 25_000, 'GeForce RTX 3080'],
  [/rtx 3070(?! laptop)/, 22_300, 'GeForce RTX 3070'],
  [/rtx 3060 ti(?! laptop)/, 20_000, 'GeForce RTX 3060 Ti'],
  [/rtx 3060(?! laptop)/, 17_000, 'GeForce RTX 3060'],
  [/rtx 2080 ti/, 21_800, 'GeForce RTX 2080 Ti'],
  [/rtx 2080(?! laptop)/, 18_500, 'GeForce RTX 2080'],
  [/rtx 2070(?! laptop)/, 16_500, 'GeForce RTX 2070'],
  [/rtx 2060(?! laptop)/, 14_000, 'GeForce RTX 2060'],
  [/gtx 1080 ti/, 18_500, 'GeForce GTX 1080 Ti'],
  [/gtx 1070/, 13_500, 'GeForce GTX 1070'],
  [/gtx 1660/, 11_500, 'GeForce GTX 1660'],
  [/gtx 1060/, 10_000, 'GeForce GTX 1060'],
  [/gtx 1050/, 6_000, 'GeForce GTX 1050'],
  // NVIDIA laptop
  [/rtx 5090 laptop/, 32_000, 'GeForce RTX 5090 Laptop'],
  [/rtx 5080 laptop/, 28_500, 'GeForce RTX 5080 Laptop'],
  [/rtx 5070 ti laptop/, 24_000, 'GeForce RTX 5070 Ti Laptop'],
  [/rtx 5070 laptop/, 21_000, 'GeForce RTX 5070 Laptop'],
  [/rtx 4090 laptop/, 29_000, 'GeForce RTX 4090 Laptop'],
  [/rtx 4080 laptop/, 26_000, 'GeForce RTX 4080 Laptop'],
  [/rtx 4070 laptop/, 20_000, 'GeForce RTX 4070 Laptop'],
  [/rtx 4060 laptop/, 18_000, 'GeForce RTX 4060 Laptop'],
  [/rtx 4050 laptop/, 15_000, 'GeForce RTX 4050 Laptop'],
  [/rtx 3080 ti laptop/, 19_500, 'GeForce RTX 3080 Ti Laptop'],
  [/rtx 3080 laptop/, 18_000, 'GeForce RTX 3080 Laptop'],
  [/rtx 3070 laptop/, 17_000, 'GeForce RTX 3070 Laptop'],
  [/rtx 3060 laptop/, 15_500, 'GeForce RTX 3060 Laptop'],
  [/rtx 3050 laptop/, 9_500, 'GeForce RTX 3050 Laptop'],
  [/rtx 2060 laptop/, 11_500, 'GeForce RTX 2060 Laptop'],
  // NVIDIA workstation
  [/rtx 6000 ada/, 36_000, 'RTX 6000 Ada'],
  [/rtx a6000/, 26_000, 'RTX A6000'],
  [/rtx a4000/, 19_000, 'RTX A4000'],
  // AMD Radeon
  [/rx 9070 xt/, 31_000, 'Radeon RX 9070 XT'],
  [/rx 9070\b/, 28_500, 'Radeon RX 9070'],
  [/rx 7900 xtx/, 29_500, 'Radeon RX 7900 XTX'],
  [/rx 7900 xt\b/, 27_500, 'Radeon RX 7900 XT'],
  [/rx 7800 xt/, 24_000, 'Radeon RX 7800 XT'],
  [/rx 7700 xt/, 21_000, 'Radeon RX 7700 XT'],
  [/rx 7600/, 16_000, 'Radeon RX 7600'],
  [/rx 6950 xt/, 28_000, 'Radeon RX 6950 XT'],
  [/rx 6900 xt/, 27_000, 'Radeon RX 6900 XT'],
  [/rx 6800 xt/, 26_000, 'Radeon RX 6800 XT'],
  [/rx 6800\b/, 24_000, 'Radeon RX 6800'],
  [/rx 6700 xt/, 19_500, 'Radeon RX 6700 XT'],
  [/rx 6600/, 14_500, 'Radeon RX 6600'],
  [/rx 580/, 8_800, 'Radeon RX 580'],
  // Intel Arc
  [/arc b580/, 18_500, 'Arc B580'],
  [/arc a770/, 17_000, 'Arc A770'],
  [/arc a750/, 15_500, 'Arc A750'],
  [/arc 140v/, 7_500, 'Arc 140V'],
  [/arc 130v/, 6_500, 'Arc 130V'],
  // Integrated
  [/radeon 890m/, 7_800, 'Radeon 890M'],
  [/radeon 880m/, 6_800, 'Radeon 880M'],
  [/radeon 780m/, 7_000, 'Radeon 780M'],
  [/radeon 760m/, 5_800, 'Radeon 760M'],
  [/radeon 680m/, 5_600, 'Radeon 680M'],
  // Meteor Lake reports only "Intel Arc Graphics", without a number.
  [/^intel arc graphics$/, 5_700, 'Intel Arc Graphics (iGPU)'],
  [/iris xe/, 3_000, 'Intel Iris Xe'],
  [/uhd graphics 7[57]0/, 1_700, 'Intel UHD 770'],
  [/uhd graphics/, 1_100, 'Intel UHD Graphics'],
  [/radeon(?: tm)? graphics$/, 2_500, 'Radeon Graphics (iGPU)'],
  [/radeon vega/, 2_200, 'Radeon Vega (iGPU)'],
  // Apple silicon
  [/apple m4 max/, 24_000, 'Apple M4 Max GPU'],
  [/apple m4 pro/, 16_000, 'Apple M4 Pro GPU'],
  [/apple m4\b/, 11_000, 'Apple M4 GPU'],
  [/apple m3 max/, 22_000, 'Apple M3 Max GPU'],
  [/apple m3\b/, 10_000, 'Apple M3 GPU'],
  [/apple m2\b/, 8_500, 'Apple M2 GPU'],
  [/apple m1\b/, 7_000, 'Apple M1 GPU'],
]

function lookup(table: Entry[], vendor: string, model: string): BenchmarkMatch | null {
  const normalized = normalizeModel(`${vendor} ${model}`)
  const withoutVendor = normalizeModel(model)
  for (const [pattern, index, label] of table) {
    if (pattern.test(normalized) || pattern.test(withoutVendor)) return { index, label }
  }
  return null
}

export function lookupCpu(vendor: string, model: string): BenchmarkMatch | null {
  return lookup(CPUS, vendor, model)
}

export function lookupGpu(vendor: string, model: string): BenchmarkMatch | null {
  return lookup(GPUS, vendor, model)
}
