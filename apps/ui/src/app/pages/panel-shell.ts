import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { DataSource } from '../core/data-source';
import { PanelSession } from '../core/panel-session';

@Component({
  selector: 'app-panel-shell',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class PanelShell {
  constructor() {
    const session = inject(PanelSession);
    const router = inject(Router);
    if (!session.token()) {
      void router.navigateByUrl('/panel/login');
      return;
    }
    void inject(DataSource).start();
  }
}
