/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Maps JavaScript API key for the Geocoder (src/places/google.ts); never in the repo. */
  readonly VITE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
