import { BaseComponent } from '../../core/base-component.ts';
import { formatMinor } from '../../core/model/money.ts';
import { extentOf, project, niceTicks } from './scale.ts';
import type { Extent } from './scale.ts';
import template from './trajectory-chart.html?raw';
import style from './trajectory-chart.css?raw';

export interface ChartSeries {
  label: string;
  points: number[];
  /* A CSS custom property name, so a series is coloured by what it MEANS —
   * expected, actual, goal — and never by an arbitrary palette slot. */
  token: string;
}

/* REQ-APP-4: native Canvas 2D, no charting library. */
export class TrajectoryChart extends BaseComponent {
  static readonly tagName = 'trajectory-chart';

  private times: number[] = [];
  private series: ChartSeries[] = [];
  private caption = '';

  constructor() {
    super(template, style);
  }

  override init(): void {
    this.draw();
    /* Redraw on resize and on a theme change: the colours come from CSS custom
     * properties, and a canvas does not restyle itself. */
    new ResizeObserver(() => { this.draw(); }).observe(this);
    globalThis.matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { this.draw(); });
  }

  setData(times: number[], series: ChartSeries[], caption = ''): void {
    this.times = times;
    this.series = series;
    this.caption = caption;
    this.draw();
  }

  private token(name: string, fallback: string): string {
    const value = getComputedStyle(this).getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  }

  private draw(): void {
    const canvas = this.querySelector('canvas');
    const wrap = this.querySelector('.canvas-wrap');
    if (!(canvas instanceof HTMLCanvasElement) || wrap === null) return;

    const caption = this.querySelector('figcaption');
    if (caption !== null) caption.textContent = this.caption;
    this.drawLegend();

    const cssWidth = Math.max(320, wrap.clientWidth);
    const cssHeight = Math.round(cssWidth * 0.45);
    const ratio = globalThis.devicePixelRatio ?? 1;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (this.times.length === 0 || this.series.length === 0) return;

    const ink = this.token('--colour-ink-faint', '#888');
    const grid = this.token('--colour-border', '#ddd');
    const pad = { top: 12, right: 16, bottom: 26, left: 76 };
    const plotLeft = pad.left;
    const plotRight = cssWidth - pad.right;
    const plotTop = pad.top;
    const plotBottom = cssHeight - pad.bottom;

    const extent = extentOf(this.series.map((s) => s.points));
    const lastTime = this.times[this.times.length - 1] ?? 1;
    const timeExtent: Extent = { min: this.times[0] ?? 0, max: lastTime };

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';

    for (const tick of niceTicks(extent)) {
      const y = project(tick, extent, plotBottom, plotTop);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft, Math.round(y) + 0.5);
      ctx.lineTo(plotRight, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.textAlign = 'right';
      ctx.fillText(formatMinor(tick), plotLeft - 8, y);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    for (const years of [0, 10, 20, 30]) {
      const day = years * 365;
      if (day > timeExtent.max) continue;
      const x = project(day, timeExtent, plotLeft, plotRight);
      ctx.fillText(years === 0 ? 'now' : `${years}y`, x, plotBottom + 12);
    }

    for (const line of this.series) {
      ctx.strokeStyle = this.token(line.token, '#333');
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      line.points.forEach((value, i) => {
        const x = project(this.times[i] ?? 0, timeExtent, plotLeft, plotRight);
        const y = project(value, extent, plotBottom, plotTop);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  private drawLegend(): void {
    const legend = this.querySelector('.legend');
    if (legend === null) return;
    legend.replaceChildren(...this.series.map((line) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = `var(${line.token})`;
      const label = document.createElement('span');
      label.textContent = line.label;
      item.append(swatch, label);
      return item;
    }));
  }
}

if (customElements.get(TrajectoryChart.tagName) === undefined) {
  customElements.define(TrajectoryChart.tagName, TrajectoryChart);
}
