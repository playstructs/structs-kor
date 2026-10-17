/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANSPORT?: string;
  readonly VITE_GUILD_ID?: string;
  readonly VITE_GUILD_API?: string;
  readonly VITE_GRASS_URL?: string;
  readonly VITE_MATRIX_URL?: string;
  readonly VITE_LCD_URL?: string;
  readonly VITE_SITE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
