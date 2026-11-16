import type { HotbarCapabilities } from '@hotbar/shared';

export interface HotbarBootstrap {
  agentUrl: string;
  token: string;
  capabilities: HotbarCapabilities;
}

declare global {
  interface Window {
    hotbar?: {
      getBootstrap: () => Promise<HotbarBootstrap>;
    };
  }
}
