/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** S6-01: origen de la API y de los WebSockets (p. ej. `https://api.guinoteonline.es`). Vacío = el mismo de la web. */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
