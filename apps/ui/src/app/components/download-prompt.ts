import { Component, input, output } from '@angular/core';
import type { DownloadOffer } from '../core/data-source';

@Component({
  selector: 'app-download-prompt',
  templateUrl: './download-prompt.html',
})
export class DownloadPrompt {
  readonly items = input.required<DownloadOffer[]>();
  readonly agreed = output<void>();
  readonly cancelled = output<void>();
}
