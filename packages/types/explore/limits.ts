/**
 * explore.limits — the discovery contract's plain numbers, with no Zod behind them, so a client
 * bundle can read one without loading the schemas (`@projective/types/explore/limits`). The schemas
 * in this folder read them from here, so each number has one home.
 */

/** The longest query the suggest route accepts; anything longer is a paste, not a typeahead. */
export const SUGGEST_QUERY_MAX = 80;
