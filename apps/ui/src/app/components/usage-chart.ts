import { AfterViewInit, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import { Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

@Component({
  selector: 'app-usage-chart',
  template: `
    <div class="rounded border border-line bg-surface p-3">
      <div class="text-[11px] uppercase tracking-wide text-faint">{{ title() }}</div>
      @if (unavailable()) {
        <p class="mt-6 text-sm text-faint">Not reported for the process runtime.</p>
      } @else {
        <div class="mt-2 h-24">
          <canvas #canvas></canvas>
        </div>
      }
    </div>
  `,
})
export class UsageChart implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly data = input<number[]>([]);
  readonly color = input('#4c8dff');
  readonly unavailable = input(false);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;

  constructor() {
    effect(() => {
      const points = this.data();
      const color = this.color();
      if (!this.chart) return;
      this.chart.data.labels = points.map((_, index) => String(index + 1));
      this.chart.data.datasets[0] = {
        data: points,
        borderColor: color,
        backgroundColor: color + '33',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 1.5,
      };
      this.chart.update('none');
    });
  }

  ngAfterViewInit(): void {
    const element = this.canvas()?.nativeElement;
    if (!element || this.unavailable()) return;
    this.chart = new Chart(element, {
      type: 'line',
      data: { labels: [], datasets: [{ data: [] }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: {
            beginAtZero: true,
            ticks: { color: '#93a0b0', maxTicksLimit: 3, font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.06)' },
            border: { display: false },
          },
        },
      },
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
