const SECRET_KEY = /key|token|password|secret|license/i;

export function secretValues(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY.test(key) && value.length >= 4)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function redact(line: string, secrets: readonly string[]): string {
  let output = line;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join('********');
  }
  return output;
}
