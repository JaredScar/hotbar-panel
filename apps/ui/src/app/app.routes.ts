import { Routes } from '@angular/router';
import { DataSource } from './core/data-source';
import { PanelDataSource } from './core/panel.source';

const serverChildren: Routes = [
  { path: '', loadComponent: () => import('./pages/console-page').then((module) => module.ConsolePage) },
  { path: 'properties', loadComponent: () => import('./pages/properties-page').then((module) => module.PropertiesPage) },
  { path: 'files', data: { tool: 'files' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'backups', data: { tool: 'backups' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'schedules', data: { tool: 'schedules' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'network', data: { tool: 'network' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'startup', data: { tool: 'startup' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'activity', data: { tool: 'activity' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'players', data: { tool: 'players' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'plugins', data: { tool: 'plugins' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'world', data: { tool: 'world' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'resources', data: { tool: 'resources' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'users', data: { tool: 'users' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'databases', data: { tool: 'databases' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
  { path: 'version', data: { tool: 'version' }, loadComponent: () => import('./pages/server-tools').then((module) => module.ServerToolsPage) },
];

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/server-list').then((module) => module.ServerListPage),
  },
  {
    path: 'machine',
    loadComponent: () => import('./pages/machine-page').then((module) => module.MachinePage),
  },
  {
    path: 'setup',
    loadComponent: () => import('./pages/setup-page').then((module) => module.SetupPage),
  },
  {
    path: 'create',
    loadComponent: () => import('./pages/quick-create').then((module) => module.QuickCreatePage),
  },
  {
    path: 'panel/login',
    loadComponent: () => import('./pages/panel-login').then((module) => module.PanelLoginPage),
  },
  {
    path: 'panel/account',
    loadComponent: () => import('./pages/account-page').then((module) => module.AccountPage),
  },
  {
    path: 'panel',
    loadComponent: () => import('./pages/panel-shell').then((module) => module.PanelShell),
    providers: [{ provide: DataSource, useClass: PanelDataSource }],
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/server-list').then((module) => module.ServerListPage),
      },
      {
        path: 'server/:serverId',
        loadComponent: () => import('./pages/server-shell').then((module) => module.ServerShell),
        children: serverChildren,
      },
    ],
  },
  {
    path: 'server/:serverId',
    loadComponent: () => import('./pages/server-shell').then((module) => module.ServerShell),
    children: serverChildren,
  },
  { path: '**', redirectTo: '' },
];
