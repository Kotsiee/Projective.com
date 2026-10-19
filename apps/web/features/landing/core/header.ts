/**
 * header.ts — the header bar's shared geometry (`flows/LANDING.md` §2.1–§2.3, §2.8).
 *
 * `LandingHeader` reads it to decide when the bar is "at the top" of the page, where it wears no
 * glass and no hairline.
 */

/**
 * The scroll offset (CSS px) up to which the bar counts as at the top of the page. Past it the bar
 * always wears its glass and its bottom hairline.
 */
export const HEADER_TOP_BAND_PX = 48;
