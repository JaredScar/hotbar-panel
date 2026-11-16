export const PERMISSION_GROUPS = {
  server: ['server.read', 'servers.create', 'servers.delete'],
  control: ['control.console', 'control.start', 'control.stop', 'control.restart', 'control.kill', 'websocket.connect'],
  files: ['file.create', 'file.read', 'file.update', 'file.delete', 'file.archive', 'file.sftp'],
  backup: ['backup.read', 'backup.create', 'backup.delete', 'backup.download', 'backup.restore'],
  allocation: ['allocation.read', 'allocation.create', 'allocation.update', 'allocation.delete'],
  startup: ['startup.read', 'startup.update', 'startup.docker-image'],
  database: ['database.create', 'database.read', 'database.update', 'database.delete', 'database.view_password'],
  schedule: ['schedule.create', 'schedule.read', 'schedule.update', 'schedule.delete'],
  user: ['user.create', 'user.read', 'user.update', 'user.delete'],
  settings: ['settings.rename', 'settings.reinstall', 'activity.read'],
} as const;

export const PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

export type Permission = (typeof PERMISSIONS)[number];

export interface Principal {
  id: string;
  permissions: '*' | readonly Permission[];
}

export function hasPermission(principal: Principal, permission: Permission): boolean {
  if (principal.permissions === '*') return true;
  return principal.permissions.includes(permission);
}
