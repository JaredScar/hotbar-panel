import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners, inject } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withRouterConfig } from '@angular/router';
import { routes } from './app.routes';
import { DataSource } from './core/data-source';
import { LocalAgentDataSource } from './core/local-agent.source';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    { provide: DataSource, useExisting: LocalAgentDataSource },
    provideAppInitializer(() => inject(LocalAgentDataSource).start()),
  ],
};
