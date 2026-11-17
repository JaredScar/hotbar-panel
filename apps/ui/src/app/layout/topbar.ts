import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AppUpdate } from '../core/app-update';
import { DataSource } from '../core/data-source';
import { ServerSearch } from '../core/search';

@Component({
  selector: 'app-topbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './topbar.html',
})
export class Topbar {
  protected readonly data = inject(DataSource);
  protected readonly search = inject(ServerSearch);
  protected readonly updates = inject(AppUpdate);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected openSearch(): void {
    this.search.open.set(true);
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  protected onQuery(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.query.set(value);
  }

  protected closeSearch(): void {
    this.search.open.set(false);
    this.search.query.set('');
  }
}
