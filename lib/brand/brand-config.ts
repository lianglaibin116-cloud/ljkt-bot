/**
 * Brand configuration.
 *
 * The reference (live deployment) resolves the brand per vendor from the
 * desktop shell's User-Agent token. This workspace has no vendor shell: the
 * product ships with its own single brand, so the config is static and the
 * desktop flag is always off. The shape is kept so surfaces that read the
 * brand (home hero, workspace rail, site header) keep one source of truth.
 */

export interface BrandConfig {
  /** Full product name (page titles, logo alt text). */
  productName: string;
  /** Short name for space-constrained spots. */
  shortName: string;
  /** Full product logo asset under `public/`. */
  logoSrc: string;
  /** Whether `logoSrc` already carries the product wordmark. */
  logoHasWordmark: boolean;
  /** Standalone brand symbol under `public/` (favicon and compact headers). */
  markSrc: string;
  /** Browser theme color (`<meta name="theme-color">` / PWA). */
  themeColor: string;
}

/**
 * Public env overrides let a deployment personalize the product identity
 * without changing the shared interface components.
 */
export const DEFAULT_BRAND: BrandConfig = {
  productName: process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || '灵境课堂',
  shortName: process.env.NEXT_PUBLIC_BRAND_SHORT_NAME?.trim() || '灵境',
  logoSrc: process.env.NEXT_PUBLIC_BRAND_LOGO?.trim() || '/lingjing-logo.png',
  logoHasWordmark: true,
  markSrc: process.env.NEXT_PUBLIC_BRAND_MARK?.trim() || '/lingjing-mark.png',
  themeColor: '#315846',
};
