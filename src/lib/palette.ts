/**
 * Series identity hues, one per module. Validated dark-mode categorical slots, checked
 * against the card surface `#14161c`. Where several appear in one chart the order below
 * is the order to draw them in — CPU → RAM → GPU → storage passes every adjacent-pair
 * check (lightness band, chroma floor, colour-vision separation, 3:1 contrast); CPU next
 * to GPU does not, so never put those two side by side.
 */
export const HUES = {
  cpu: '#3987e5',
  memory: '#199e70',
  gpu: '#9085e9',
  storage: '#c98500',
  network: '#d95926',
  battery: '#d55181',
  /** Recessive grey for a secondary series or a remainder ("Extras", upload). */
  neutral: '#6b7385',
} as const
