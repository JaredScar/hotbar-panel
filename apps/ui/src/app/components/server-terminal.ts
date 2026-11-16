import { AfterViewInit, Component, ElementRef, OnDestroy, viewChild } from '@angular/core';
import type { LogLine } from '@hotbar/shared';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

@Component({
  selector: 'app-server-terminal',
  template: `<div #screen class="h-full w-full"></div>`,
  styles: `
    :host {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex: 1 1 auto;
      background: #0e131b;
    }
  `,
})
export class ServerTerminal implements AfterViewInit, OnDestroy {
  private readonly screen = viewChild.required<ElementRef<HTMLDivElement>>('screen');
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private observer: ResizeObserver | null = null;
  private readonly pending: LogLine[] = [];

  ngAfterViewInit(): void {
    const term = new Terminal({
      disableStdin: true,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: false,
      convertEol: true,
      theme: {
        background: '#0e131b',
        foreground: '#d7dee8',
        cursor: '#4c8dff',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(this.screen().nativeElement);
    fit.fit();
    this.term = term;
    this.fit = fit;
    this.observer = new ResizeObserver(() => fit.fit());
    this.observer.observe(this.screen().nativeElement);
    for (const line of this.pending.splice(0)) this.paint(line);
  }

  write(line: LogLine): void {
    if (!this.term) {
      this.pending.push(line);
      return;
    }
    this.paint(line);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.term?.dispose();
  }

  private paint(line: LogLine): void {
    const color = line.stream === 'stderr' ? '\x1b[38;5;203m' : line.stream === 'system' ? '\x1b[38;5;245m' : '';
    this.term?.writeln(`${color}${line.line}\x1b[0m`);
  }
}
