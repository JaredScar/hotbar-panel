import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PROPERTY_FIELDS, PROPERTY_GROUPS, type PropertyField, checkPropertyValue } from '@hotbar/shared';
import { DataSource } from '../core/data-source';

@Component({
  selector: 'app-properties-page',
  templateUrl: './properties-page.html',
})
export class PropertiesPage {
  private readonly data = inject(DataSource);
  private readonly route = inject(ActivatedRoute);

  protected readonly serverId = signal(this.route.snapshot.paramMap.get('serverId') ?? '');
  protected readonly values = signal<Record<string, string>>({});
  protected readonly original = signal<Record<string, string>>({});
  protected readonly query = signal('');
  protected readonly revealed = signal<Record<string, boolean>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal('');
  protected readonly busy = signal(false);
  protected readonly fields = PROPERTY_FIELDS;

  protected readonly groups = computed(() => {
    const query = this.query().trim().toLowerCase();
    return PROPERTY_GROUPS.map((name) => ({
      name,
      fields: PROPERTY_FIELDS.filter((field) => field.group === name && matches(field, query)),
    })).filter((group) => group.fields.length > 0);
  });

  protected readonly extras = computed(() => {
    const known = new Set(PROPERTY_FIELDS.map((field) => field.key));
    const query = this.query().trim().toLowerCase();
    return Object.keys(this.original())
      .filter((key) => !known.has(key) && (!query || key.toLowerCase().includes(query)))
      .sort();
  });

  constructor() {
    void this.load();
  }

  protected shown(field: PropertyField): string {
    return this.values()[field.key] ?? field.defaultValue ?? '';
  }

  protected extra(key: string): string {
    return this.values()[key] ?? '';
  }

  protected unknownChoice(field: PropertyField): boolean {
    const value = this.shown(field);
    return Boolean(field.options && value && !field.options.some((option) => option.value === value));
  }

  protected revealedSecret(key: string): boolean {
    return this.revealed()[key] === true;
  }

  protected toggleSecret(key: string): void {
    this.revealed.update((current) => ({ ...current, [key]: !current[key] }));
  }

  protected setValue(key: string, value: string): void {
    this.saved.set('');
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  protected pendingCount(): number {
    return Object.keys(this.pending()).length;
  }

  protected async save(): Promise<void> {
    const payload = this.pending();
    const keys = Object.keys(payload);
    if (keys.length === 0) {
      this.saved.set('Nothing changed.');
      this.error.set(null);
      return;
    }
    for (const key of keys) {
      const problem = checkPropertyValue(key, payload[key] ?? '');
        if (problem) {
        this.error.set(problem);
        this.saved.set('');
        return;
      }
    }
    this.busy.set(true);
    this.error.set(null);
    this.saved.set('');
    try {
      const result = await this.write(payload);
      this.values.set({ ...result.values });
      this.original.set({ ...result.values });
      this.saved.set('Saved. Restart the server to apply it.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  private pending(): Record<string, string> {
    const payload: Record<string, string> = {};
    const current = this.values();
    const original = this.original();
    for (const field of PROPERTY_FIELDS) {
      if (!(field.key in current)) continue;
      const next = current[field.key] ?? '';
      const before = original[field.key] ?? field.defaultValue ?? '';
      if (next !== before) payload[field.key] = next;
    }
    for (const key of Object.keys(original)) {
      if (PROPERTY_FIELDS.some((field) => field.key === key)) continue;
      if ((current[key] ?? '') !== (original[key] ?? '')) payload[key] = current[key] ?? '';
    }
    return payload;
  }

  private async write(payload: Record<string, string>) {
    try {
      return await this.data.writeProperties(this.serverId(), payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('Can’t reach the Hotbar agent') && !message.includes('did not answer')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return this.data.writeProperties(this.serverId(), payload);
    }
  }

  private async load(): Promise<void> {
    try {
      const result = await this.data.readProperties(this.serverId());
      this.values.set({ ...result.values });
      this.original.set({ ...result.values });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read server.properties');
    }
  }
}

function matches(field: PropertyField, query: string): boolean {
  if (!query) return true;
  return `${field.label} ${field.key} ${field.help}`.toLowerCase().includes(query);
}
