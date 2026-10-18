/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANSPORT?: string;
  readonly VITE_GUILD_ID?: string;
  readonly VITE_GUILD_API?: string;
  readonly VITE_GRASS_URL?: string;
  readonly VITE_MATRIX_URL?: string;
  readonly VITE_LCD_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_DESKTOP_RELEASES?: string;
  /** Desktop builds: the website's root (origin and base path), for share links. */
  readonly VITE_WEB_ROOT?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }

declare module 'lottie-web/build/player/lottie_svg' {
  import lottie from 'lottie-web';
  export default lottie;
}
