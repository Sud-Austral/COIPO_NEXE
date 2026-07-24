/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base del proxy propio; sin secretos (CLAUDE.md §6). */
  readonly VITE_API_BASE?: string
  /** "1" = demo estático: simulador en el navegador, sin proxy (GitHub Pages). */
  readonly VITE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
