/* The arithmetic behind the chart, kept out of the canvas so it can be tested
 * without a DOM. Nothing here draws. */

export interface Extent { min: number; max: number }

export function extentOf(series: readonly (readonly number[])[]): Extent {
  let min = Infinity;
  let max = -Infinity;
  for (const line of series) {
    for (const value of line) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  /* A flat series would otherwise divide by zero and draw nothing. */
  if (min === max) return min === 0 ? { min: 0, max: 1 } : { min: Math.min(0, min), max: max * 1.1 };
  /* Money is read against zero — a balance chart that crops the axis
   * exaggerates every movement on it. */
  return { min: Math.min(0, min), max };
}

/* Map a value onto pixels by saying explicitly where each END of the range
 * sits. Naming the endpoints `atMin`/`atMax` rather than `from`/`to` is
 * deliberate: canvas y grows downward and x grows rightward, so the caller must
 * state which pixel the minimum belongs at. An implicit convention here is what
 * drew a balance chart upside down with a passing test. */
export function project(value: number, extent: Extent, atMin: number, atMax: number): number {
  const span = extent.max - extent.min;
  if (span === 0) return atMin;
  return atMin + ((value - extent.min) / span) * (atMax - atMin);
}

/* Round axis ticks a person would actually choose: 1, 2, 5 and their decades.
 * Anything else reads as noise on an axis. */
export function niceTicks(extent: Extent, target = 5): number[] {
  const span = extent.max - extent.min;
  if (span <= 0) return [extent.min];
  const rough = span / target;
  const decade = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * decade).find((s) => s >= rough) ?? decade * 10;

  const ticks: number[] = [];
  for (let t = Math.ceil(extent.min / step) * step; t <= extent.max + step / 1e6; t += step) {
    ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  }
  return ticks;
}
