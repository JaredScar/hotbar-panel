import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { DataSource } from './core/data-source';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: DataSource,
          useValue: {
            servers: signal([]),
            connected: signal(true),
            connectionError: signal(null),
            dev: signal(false),
            revision: signal(0),
            remote: signal(false),
            linkedPanel: signal(null),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the Hotbar top bar', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('header')?.textContent).toContain('Hotbar');
  });
});
