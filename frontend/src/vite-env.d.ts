/// <reference types="vite/client" />

interface Window {
  engineWindow?: {
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<void>;
    close: () => Promise<void>;
  };
}
