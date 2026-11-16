import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ServerSearch {
  readonly open = signal(false);
  readonly query = signal('');
}
