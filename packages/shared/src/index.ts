export const HOTBAR_VERSION = '0.1.0';

export type { ServerState, ServerLimits, ServerAllocation, ServerStop, ServerDefinition, ServerStats, ServerView, CreateServerRequest, PowerAction } from './server.js';
export type { LogLine, AgentEvent, LogSnapshot, InstallProgress, PanelDownlink, AgentUplink } from './protocol.js';
export type { Permission, Principal } from './permissions.js';
export { PERMISSIONS, PERMISSION_GROUPS, hasPermission } from './permissions.js';
export type { TemplateFile, TemplateVariable, TemplateValidation } from './template.js';
export { ALLOWED_INSTALL_STEPS, validateTemplate } from './template.js';
export type { MachineInfo, HotbarCapabilities } from './machine.js';
export type { ActivityEntry } from './activity.js';
export { substituteArg, substituteCommand } from './args.js';
export type { ZipEntry, ZipAssessment } from './zip-guard.js';
export { assessZipEntries, ZIP_LIMITS } from './zip-guard.js';
export type { GameId, McProviderId, McVersion, McGamemode, McDifficulty, McCreateRequest, ServerProperties, Reachability } from './minecraft.js';
export { GAMES, MC_PROVIDERS } from './minecraft.js';
export type { FileEntry, FileContent, BackupInfo, ScheduleInfo, ModpackHit, SetupStatus } from './ops.js';
