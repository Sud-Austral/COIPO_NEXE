/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base del proxy propio; sin secretos (CLAUDE.md §6). */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
