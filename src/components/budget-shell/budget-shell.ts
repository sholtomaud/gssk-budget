import { BaseComponent } from '../../core/base-component.ts';
import { KernelClient } from '../../core/kernel/kernel-client.ts';
import { founderModel } from '../../core/model/founder.ts';
import { formatMinor } from '../../core/model/money.ts';
import { TrajectoryChart } from '../trajectory-chart/trajectory-chart.ts';
import template from './budget-shell.html?raw';
import style from './budget-shell.css?raw';

/* Layout, route host, and owner of the kernel worker instance (REQ-APP-6). */
export class BudgetShell extends BaseComponent {
  static readonly tagName = 'budget-shell';

  private kernel?: KernelClient;

  constructor() {
    super(template, style);
  }

  override init(): void {
    /* REQ-APP-2: light DOM throughout — querySelector, never shadowRoot. */
    void this.runFounderForecast();
  }

  disconnectedCallback(): void {
    this.kernel?.terminate();
  }

  private say(message: string, state: 'loading' | 'ready' | 'failed'): void {
    const status = this.querySelector('.status');
    if (status === null) return;
    status.textContent = message;
    status.setAttribute('data-state', state);
  }

  private async runFounderForecast(): Promise<void> {
    const chart = this.querySelector('trajectory-chart');
    try {
      this.kernel = new KernelClient();
      const built = founderModel();

      /* 30 years of daily steps, sampled weekly: 10,950 steps is more points
       * than a 900px chart can show, and drawing them all would be a lie about
       * the resolution anyone can read. */
      const started = performance.now();
      const { trajectory, info } = await this.kernel.run(
        JSON.stringify(built.model), 365 * 30, 1, 7,
      );
      const elapsed = Math.round(performance.now() - started);

      const instance = built.index.instanceOf.get('everyday') ?? '';
      const balanceId = built.index.memberNodeId(instance, 'balance');
      const balance = trajectory.series[trajectory.nodeIds.indexOf(balanceId)];

      if (chart instanceof TrajectoryChart && balance !== undefined) {
        chart.setData(trajectory.t, [
          { label: 'Account balance — what the model expects',
            points: balance, token: '--colour-expected' },
        ], `${trajectory.t.length} weekly samples over 30 years.`);

        const end = balance[balance.length - 1] ?? 0;
        this.say(
          `The model expects a balance of ${formatMinor(end)} after 30 years. ` +
          `Computed in ${elapsed} ms in a worker.`,
          'ready',
        );
      }

      const kernel = this.querySelector('.kernel');
      if (kernel !== null) {
        kernel.textContent =
          `GSSK ${info.version}, digest ${info.wasmSha256.slice(0, 12)}… verified.`;
      }
    } catch (error) {
      /* A failure to load or verify the kernel is reported plainly. Showing a
         chart of nothing would be worse than showing no chart. */
      this.say(
        `The forecast did not run: ${error instanceof Error ? error.message : String(error)}`,
        'failed',
      );
    }
  }
}

if (customElements.get(BudgetShell.tagName) === undefined) {
  customElements.define(BudgetShell.tagName, BudgetShell);
}
