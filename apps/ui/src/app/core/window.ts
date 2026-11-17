import type { HotbarCapabilities } from '@hotbar/shared';

export interface HotbarBootstrap {
  agentUrl: string;
  token: string;
  capabilities: HotbarCapabilities;
}

export interface UpdateStatus {
  current: string;
  latest: string;
  available: boolean;
  releaseUrl: string | null;
  packaged: boolean;
}

export interface UpdateProgress {
  received: number;
  total: number;
}

declare global {
  interface Window {
    hotbar?: {
      getBootstrap: () => Promise<HotbarBootstrap>;
      checkForUpdate?: () => Promise<UpdateStatus>;
      installUpdate?: () => Promise<{ replacing: boolean }>;
      onUpdateProgress?: (listener: (progress: UpdateProgress) => void) => () => void;
    };
  }
}
