const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Replace `${NAME}` inside one argument. Values are not split and are not passed to a shell. */
export function substituteArg(arg: string, vars: Record<string, string>): string {
  return arg.replace(PLACEHOLDER, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = vars[key] ?? '';
    if (value.includes('\0')) {
      throw new Error(`variable ${key} contains NUL`);
    }
    return value;
  });
}

export function substituteCommand(command: readonly string[], vars: Record<string, string>): string[] {
  return command.map((arg) => substituteArg(arg, vars));
}
