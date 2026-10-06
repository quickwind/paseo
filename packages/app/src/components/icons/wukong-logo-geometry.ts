// Internal edition: the Wukong line-art head (hair tufts, headband, ears, peach-shaped
// face, eyes) on a 700×700 canvas. The logo component and the web splash mask both
// draw from these paths so the mark is defined once.

export const WUKONG_LOGO_VIEWBOX = "0 0 700 700";
export const WUKONG_LOGO_STROKE_WIDTH = 34;

export const WUKONG_LOGO_STROKE_PATHS: readonly string[] = [
  // Ears
  "M160 360 C112 346 96 381 96 409 C96 439 116 472 160 460",
  "M540 360 C588 346 604 381 604 409 C604 439 584 472 540 460",
  // Head with flame-like hair tufts
  "M170 300 C172 232 204 186 258 166 L290 112 L330 160 L350 92 L370 160 L410 112 L442 166 C496 186 528 232 530 300 C540 330 540 360 540 386 C540 524 454 610 350 610 C246 610 160 524 160 386 C160 360 160 330 170 300 Z",
  // Headband
  "M170 300 C246 252 454 252 530 300",
  // Peach-shaped face
  "M350 350 C328 318 254 314 244 374 C236 426 268 454 270 496 C272 552 312 580 350 580 C388 580 428 552 430 496 C432 454 464 426 456 374 C446 314 372 318 350 350 Z",
];

export const WUKONG_LOGO_EYES: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 302, cy: 410, r: 17 },
  { cx: 398, cy: 410, r: 17 },
];

/** Standalone SVG markup, for CSS masks and data URIs. */
export function wukongLogoSvgMarkup(input: { size: number; color: string }): string {
  const strokes = WUKONG_LOGO_STROKE_PATHS.map((d) => `<path d='${d}'/>`).join("");
  const eyes = WUKONG_LOGO_EYES.map(
    (eye) =>
      `<circle cx='${eye.cx}' cy='${eye.cy}' r='${eye.r}' fill='${input.color}' stroke='none'/>`,
  ).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${input.size}' height='${input.size}' viewBox='${WUKONG_LOGO_VIEWBOX}' fill='none' stroke='${input.color}' stroke-width='${WUKONG_LOGO_STROKE_WIDTH}' stroke-linecap='round' stroke-linejoin='round'>${strokes}${eyes}</svg>`;
}
