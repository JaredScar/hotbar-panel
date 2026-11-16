export const AIKAR_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs',
  '-Daikars.new.flags=true',
];

/** Heap is the chosen size minus 512 MB for the process, and never below 512 MB. */
export function heapArgs(memoryMb: number): string[] {
  const heap = Math.max(512, memoryMb - 512);
  const start = Math.min(heap, 1024);
  return [`-Xms${start}M`, `-Xmx${heap}M`, ...AIKAR_FLAGS];
}

export function minecraftCommand(java: string, memoryMb: number, jarName: string): string[] {
  return [java, ...heapArgs(memoryMb), '-jar', jarName, 'nogui'];
}

/** Forge and NeoForge install a Java argument file. The command stays an argument array. */
export function argfileCommand(java: string, argsFile: string): string[] {
  return [java, '@user_jvm_args.txt', `@${argsFile.split('\\').join('/')}`, 'nogui'];
}

export function jvmArgsFile(memoryMb: number): string {
  return `${heapArgs(memoryMb).join('\n')}\n`;
}
