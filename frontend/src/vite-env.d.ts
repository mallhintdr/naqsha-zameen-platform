/// <reference types="vite/client" />
declare const __BUILD_META__: { version: string; buildDate: number };
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_CLOUDFLARE_WORKER_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_ENABLE_TURNSTILE?: string;
}
interface Window {
  __pushEnabled?: boolean;
  [k: string]: any;
}
declare module 'leaflet.heat';
declare module 'leaflet-rotate';
declare module 'polylabel';
declare module '*.css';
