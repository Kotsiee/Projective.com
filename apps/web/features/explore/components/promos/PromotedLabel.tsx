import type { JSX } from "preact";

/**
 * PromotedLabel — the required disclosure on a promoted slot (Decision #454), and the only place the
 * word appears: a listing's organic card never carries it. A solid neutral tonal step, deliberately
 * unlike the coloured trust chips, so a placement the seller was given never borrows the look of a
 * signal they earned (PRODUCT_SPEC §Trust signals are earned claims).
 */
export function PromotedLabel(): JSX.Element {
	return <span class="ex-promoted">Promoted</span>;
}
