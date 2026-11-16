declare module 'pidusage' {
  interface PidUsageStat {
    cpu: number;
    memory: number;
    elapsed: number;
  }
  function pidusage(pid: number): Promise<PidUsageStat>;
  export default pidusage;
}
