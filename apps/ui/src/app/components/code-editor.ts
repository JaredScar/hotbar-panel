import { afterNextRender, Component, effect, ElementRef, inject, input, NgZone, OnDestroy, output, viewChild } from '@angular/core';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage, type LanguageSupport } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';

function hotbarTheme(fill: boolean): Extension {
  return EditorView.theme(
  {
    '&': {
      height: fill ? '100%' : '24rem',
      backgroundColor: '#1c232e',
      color: '#edf1f6',
    },
    '.cm-scroller': {
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1.5',
    },
    '.cm-content': { caretColor: '#4c8dff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#4c8dff' },
    '.cm-gutters': {
      backgroundColor: '#141a22',
      color: '#93a0b0',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(76, 141, 255, 0.08)' },
    '.cm-activeLineGutter': { backgroundColor: '#273140' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
  );
}

@Component({
  selector: 'app-code-editor',
  template: `<div #host class="editor-host overflow-hidden rounded border border-line"></div>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    :host.fill {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
    }
    :host.fill .editor-host {
      min-height: 0;
      flex: 1 1 auto;
    }
  `,
  host: {
    '[class.fill]': 'fill()',
  },
})
export class CodeEditor implements OnDestroy {
  readonly value = input('');
  readonly filename = input('');
  readonly fill = input(false);
  readonly changed = output<string>();
  readonly save = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private readonly zone = inject(NgZone);
  private readonly languageSlot = new Compartment();
  private view: EditorView | null = null;
  private applying = false;

  constructor() {
    afterNextRender(() => this.mount());
    effect(() => this.replaceDocument(this.value()));
    effect(() => this.applyLanguage(this.filename()));
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }

  private mount(): void {
    this.view = new EditorView({
      parent: this.host().nativeElement,
      doc: this.value(),
      extensions: [
        basicSetup,
        oneDark,
        hotbarTheme(this.fill()),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        this.languageSlot.of(languageFor(this.filename())),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              this.zone.run(() => this.save.emit());
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || this.applying) return;
          const text = update.state.doc.toString();
          this.zone.run(() => this.changed.emit(text));
        }),
      ],
    });
  }

  private replaceDocument(next: string): void {
    const view = this.view;
    if (!view || view.state.doc.toString() === next) return;
    this.applying = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    this.applying = false;
  }

  private applyLanguage(filename: string): void {
    this.view?.dispatch({ effects: this.languageSlot.reconfigure(languageFor(filename)) });
  }
}

export function languageLabel(filename: string): string {
  const ext = extensionOf(filename);
  const labels: Record<string, string> = {
    json: 'JSON',
    json5: 'JSON',
    yml: 'YAML',
    yaml: 'YAML',
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    ts: 'TypeScript',
    html: 'HTML',
    htm: 'HTML',
    xml: 'XML',
    svg: 'XML',
    css: 'CSS',
    md: 'Markdown',
    lua: 'Lua',
    toml: 'TOML',
    properties: 'Properties',
    cfg: 'Config',
    conf: 'Config',
    ini: 'Config',
    sh: 'Shell',
    bash: 'Shell',
  };
  return labels[ext] ?? 'Text';
}

function languageFor(filename: string): Extension {
  const ext = extensionOf(filename);
  const support: LanguageSupport | null =
    ext === 'json' || ext === 'json5'
      ? json()
      : ext === 'yml' || ext === 'yaml'
        ? yaml()
        : ext === 'js' || ext === 'mjs' || ext === 'cjs'
          ? javascript()
          : ext === 'ts'
            ? javascript({ typescript: true })
            : ext === 'html' || ext === 'htm'
              ? html()
              : ext === 'xml' || ext === 'svg'
                ? xml()
                : ext === 'css'
                  ? css()
                  : ext === 'md'
                    ? markdown()
                    : null;
  if (support) return support;
  if (ext === 'lua') return StreamLanguage.define(lua);
  if (ext === 'toml') return StreamLanguage.define(toml);
  if (ext === 'sh' || ext === 'bash') return StreamLanguage.define(shell);
  if (ext === 'properties' || ext === 'cfg' || ext === 'conf' || ext === 'ini') return StreamLanguage.define(properties);
  return [];
}

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}
