import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ServerView } from '@hotbar/shared';
import { DataSource } from '../core/data-source';

@Component({
  selector: 'app-register-dialog',
  imports: [FormsModule],
  templateUrl: './register-dialog.html',
})
export class RegisterDialog {
  readonly dev = input(false);
  readonly closed = output<void>();
  readonly created = output<ServerView>();

  private readonly data = inject(DataSource);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected model = {
    name: '',
    cwd: '',
    executable: '',
    args: '',
    ip: '127.0.0.1',
    port: '',
    stop: '',
  };

  protected async submit(): Promise<void> {
    this.error.set(null);
    const executable = this.model.executable.trim();
    const cwd = this.model.cwd.trim();
    if (!this.model.name.trim() || !executable || !cwd) {
      this.error.set('Name, executable, and working directory are required.');
      return;
    }
    const command = [executable, ...this.model.args.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
    const port = this.model.port.trim();
    this.saving.set(true);
    try {
      const server = await this.data.createServer({
        name: this.model.name.trim(),
        command,
        cwd,
        stop: this.model.stop.trim() ? { stdin: this.model.stop.trim(), timeoutMs: 30_000 } : { timeoutMs: 10_000 },
        allocation: port ? { ip: this.model.ip.trim() || '127.0.0.1', port: Number(port), primary: true } : null,
      });
      this.created.emit(server);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not create the server');
    } finally {
      this.saving.set(false);
    }
  }

  protected async demo(): Promise<void> {
    this.error.set(null);
    this.saving.set(true);
    try {
      const server = await this.data.createDemoServer();
      this.created.emit(server);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not create the demo server');
    } finally {
      this.saving.set(false);
    }
  }
}
