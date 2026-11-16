export const ALLOWED_INSTALL_STEPS = [
  'download',
  'steamcmd',
  'unzip',
  'write-file',
  'download-fxserver-artifact',
  'minecraft-provider',
] as const;

export type InstallStepName = (typeof ALLOWED_INSTALL_STEPS)[number];

export interface TemplateVariable {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  type?: 'string' | 'int' | 'bool';
  default?: string | number | boolean;
  rules?: string;
}

export interface TemplateFile {
  id: string;
  version: number;
  group: string;
  name: string;
  runtimes?: {
    docker?: { image?: string };
    process?: { os?: string[] };
  };
  variables?: TemplateVariable[];
  ports?: Array<{ name: string; default: number; protocols: string[] }>;
  install?: Array<{ step: string; [key: string]: unknown }>;
  startup: { command: string[]; ready_when?: { log_matches?: string } };
  stop: { stdin?: string; timeout_s: number; then?: 'kill' };
  config_files?: unknown[];
  query?: { type: string; path?: string };
  ui_plugins?: string[];
  /** Admin-authored templates only. Built-ins must leave this unset. */
  allow_shell?: boolean;
}

export interface TemplateValidation {
  ok: boolean;
  errors: string[];
  usesShell: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function validateTemplate(input: unknown): TemplateValidation {
  const errors: string[] = [];
  const template = isRecord(input) ? input : null;
  if (!template) {
    return { ok: false, errors: ['template must be an object'], usesShell: false };
  }

  if (typeof template['id'] !== 'string' || !ID_RE.test(template['id'])) {
    errors.push('id must be a lowercase slug');
  }
  if (typeof template['version'] !== 'number' || !Number.isInteger(template['version']) || template['version'] < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (typeof template['group'] !== 'string' || template['group'].trim() === '') {
    errors.push('group is required');
  }
  if (typeof template['name'] !== 'string' || template['name'].trim() === '') {
    errors.push('name is required');
  }

  const runtimes = template['runtimes'];
  if (runtimes !== undefined && !isRecord(runtimes)) {
    errors.push('runtimes must be an object');
  }

  const variables = template['variables'];
  if (variables !== undefined) {
    if (!Array.isArray(variables)) {
      errors.push('variables must be an array');
    } else {
      for (const variable of variables) {
        if (!isRecord(variable) || typeof variable['key'] !== 'string' || !KEY_RE.test(variable['key'])) {
          errors.push('each variable needs an UPPER_SNAKE key');
        }
      }
    }
  }

  const startup = template['startup'];
  if (!isRecord(startup) || !Array.isArray(startup['command']) || startup['command'].length === 0) {
    errors.push('startup.command must be a non-empty argument array');
  } else if (!startup['command'].every((part) => typeof part === 'string' && !part.includes('\0'))) {
    errors.push('startup.command entries must be strings without NUL');
  }

  const stop = template['stop'];
  if (!isRecord(stop) || typeof stop['timeout_s'] !== 'number' || stop['timeout_s'] <= 0) {
    errors.push('stop.timeout_s must be a positive number');
  }

  let usesShell = false;
  const install = template['install'];
  if (install !== undefined) {
    if (!Array.isArray(install)) {
      errors.push('install must be an array');
    } else {
      for (const step of install) {
        if (!isRecord(step) || typeof step['step'] !== 'string') {
          errors.push('each install entry needs a step name');
          continue;
        }
        if (step['step'] === 'shell') {
          usesShell = true;
          if (template['allow_shell'] !== true) {
            errors.push('shell install steps are only allowed when allow_shell is true');
          }
          continue;
        }
        if (!ALLOWED_INSTALL_STEPS.includes(step['step'] as InstallStepName)) {
          errors.push(`install step "${step['step']}" is not in the allow-list`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, usesShell };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
