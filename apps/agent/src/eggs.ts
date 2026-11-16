import type { TemplateFile } from '@hotbar/shared';

interface EggVariable {
  env_variable?: string;
  name?: string;
  default_value?: string;
  rules?: string;
}

interface EggJson {
  name?: string;
  startup?: string;
  docker_images?: Record<string, string>;
  variables?: EggVariable[];
  config?: { stop?: string };
}

const SHELL = /[|&;`$<>]|\$\{|\n/;
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Convert a Pterodactyl egg into a Hotbar template. Eggs stay Docker-only because their install scripts are shell. */
export function eggToTemplate(raw: unknown): { template: TemplateFile; notes: string[] } {
  if (!raw || typeof raw !== 'object') throw new Error('egg must be a JSON object');
  const egg = raw as EggJson;
  const name = typeof egg.name === 'string' && egg.name.trim() ? egg.name.trim().slice(0, 80) : '';
  if (!name) throw new Error('egg name is required');
  const startup = typeof egg.startup === 'string' ? egg.startup.trim() : '';
  const notes = ['Imported eggs run on the Docker runtime only.'];
  let command = ['echo', 'imported egg has no startup command'];
  if (startup) {
    if (SHELL.test(startup)) {
      notes.push('The egg startup uses a shell. Hotbar stored it as a note and will not run it.');
    } else {
      command = startup.split(/\s+/).filter(Boolean);
    }
  }
  const images = egg.docker_images ? Object.values(egg.docker_images).filter((image) => typeof image === 'string') : [];
  const image = images[0];
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'imported';
  const template: TemplateFile = {
    id,
    version: 1,
    group: 'imported',
    name,
    runtimes: image ? { docker: { image } } : undefined,
    variables: (egg.variables ?? [])
      .filter((variable) => typeof variable.env_variable === 'string' && KEY.test(variable.env_variable))
      .map((variable) => ({
        key: variable.env_variable as string,
        label: variable.name || (variable.env_variable as string),
        default: variable.default_value,
        rules: variable.rules,
      })),
    startup: { command },
    stop: { stdin: egg.config?.stop && !SHELL.test(egg.config.stop) ? egg.config.stop : 'stop', timeout_s: 30, then: 'kill' },
  };
  return { template, notes };
}
