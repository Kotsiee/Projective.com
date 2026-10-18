/**
 * header.ts — the floating header pill's shared geometry (`flows/LANDING.md` §2.1–§2.3).
 *
 * `LandingHeader` reads it to decide when the pill is "at the top" (transparent from `--bp-lg`), and
 * `LandingBackground` reads it to keep the constellation quiet behind the pill for exactly as long
 * as the pill can be transparent.
 */

/**
 * The scroll offset (CSS px) up to which the pill counts as at the top of the page — the SiteHeader's
 * band. Past it the pill always wears its glass.
 */
export const HEADER_TOP_BAND_PX = 48;
