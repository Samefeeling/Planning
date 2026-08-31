/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'excel';
  readonly VITE_SHAREPOINT_SITE_URL?: string;
  readonly VITE_SHAREPOINT_FILE_PATH?: string;
  readonly VITE_GRAPH_TOKEN?: string;
  readonly VITE_PERSIST_API_URL?: string;
  readonly VITE_REFRESH_INTERVAL_MINUTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
