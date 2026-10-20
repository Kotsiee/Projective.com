/**
 * faq — the landing's common questions as data (`flows/LANDING.md` §4.10): the section's words, and
 * the eight questions with their answers as one string each, so the visible `<details>` list
 * (`components/Faq.tsx`) and the FAQPage JSON-LD (`routes/LandingPage.tsx`) print the SAME text,
 * word for word (Decision #283 (C): "escrow" lives here, in question 1 and its answer).
 *
 * Every fee figure is computed from the server's `platform_fee_bp` (`PublicMetricsService`), never
 * written down: the rate through `formatFeePercent`, the team's share through `platformFeeFor`,
 * which truncates like SQL. With the fee unavailable (`feeBp` `null`) each fee clause drops (§4):
 * question 2 asks "Who pays the fee?" `[C3]`, its example falls back to "the team is paid", and
 * question 3's "minus the … fee" goes. Each sentence carries its §5 claims tag in the comments.
 *
 * Pure and dependency-light, so the page controller, the section and the tests share it.
 */
import { platformFeeFor } from "@projective/types/finance/fee";
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";

// #region Copy
/** The section's anchor: the questions' id (`#faq`, §4.10). */
export const FAQ_SECTION_ID = "faq";

/** The h2's id: the section is labelled by its one h2. */
export const FAQ_TITLE_ID = "faq-title";

/** The section's fixed words (§2.1 note 23, §4.10). */
export const FAQ_COPY = {
	/** The section header. */
	eyebrow: "FAQ",
	title: "Common questions.",
	/** The link under the list. */
	more: "More answers in Help",
	moreHref: "/help",
} as const;

/** The worked example's stage price, in pence: £2,000 (§4.10 question 2, §5 C4). */
export const FAQ_EXAMPLE_MINOR = 200_000;
// #endregion

// #region Money
/**
 * An amount in pence as the copy prints it: GBP, en-GB, whole pounds with no pence ("£1,900"), the
 * pence only when there are some ("£1,933.40").
 */
export function faqMoney(minor: number): string {
	const whole = minor % 100 === 0;
	return new Intl.NumberFormat("en-GB", {
		style: "currency",
		currency: "GBP",
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(minor / 100);
}

/** What the team receives on a stage of `priceMinor` at `feeBp`: the price minus the truncated fee. */
export function teamReceivesMinor(priceMinor: number, feeBp: number): number {
	return priceMinor - platformFeeFor(priceMinor, feeBp);
}
// #endregion

// #region Questions
/** One question and its answer, exactly as the page and the FAQPage JSON-LD print them. */
export interface FaqEntry {
	/** A stable key, and the `<details>` element's id suffix. */
	id: string;
	question: string;
	/** The answer as one paragraph of plain text. */
	answer: string;
}

/**
 * The eight questions (§4.10) for the fee the server read, in order. The first is the one that
 * carries "escrow" for search (Decision #283 (C)) and never opens with an unconditional "Yes"
 * (§5.1).
 */
export function faqEntries(feeBp: number | null): FaqEntry[] {
	const fee = feeBp === null ? null : formatFeePercent(feeBp);
	const example = faqMoney(FAQ_EXAMPLE_MINOR);
	return [
		{
			id: "safe",
			question: "Is my money safe? (How escrow works)",
			// [B5] [B3] [B2] [F1]
			answer:
				"Projective uses payment protection (escrow). When you pay for a stage, the money is " +
				"held safely. Work can't start until it is. The team is paid when you accept their work or " +
				"approve the stage. If work stops, Fair Exit lets you end the stage fairly.",
		},
		{
			id: "fee",
			question: fee === null ? "Who pays the fee?" : `Who pays the ${fee} fee?`,
			// [C3] [C4] [C7]
			answer: `The team does. ${fee === null ? "A" : `A ${fee}`} fee comes out of their payment ` +
				`when it's paid out. On a ${example} stage you pay ${example}, and ` +
				(feeBp === null
					? "the team is paid. "
					: `the team receives ${faqMoney(teamReceivesMinor(FAQ_EXAMPLE_MINOR, feeBp))}. `) +
				"There's no fee on refunds.",
		},
		{
			id: "fair-exit",
			question: "What if the work stops halfway?",
			// [F1] [F2] [F3] [F4]
			answer: "End the stage with Fair Exit. You pick how much was done: 25%, 50% or 75%. " +
				(fee === null
					? "The team is paid that share. "
					: `The team is paid that share, minus the ${fee} fee. `) +
				"The rest comes straight back to you, with no fee.",
		},
		{
			id: "payday",
			question: "When does the team get paid?",
			// [E1] [E2] [E3]
			answer: "When you approve, the team's money clears in 7 days. Then they can withdraw it to " +
				"their bank through Stripe. The smallest withdrawal is £10.",
		},
		{
			id: "refunds",
			question: "Where do refunds go?",
			// [G1] [G2] [E4] [E3]
			answer: "Refunds go straight back into your Projective wallet, with no fee. Use the money " +
				"again, or withdraw it to your bank. Withdrawing needs a bank account set up through " +
				"Stripe. The smallest withdrawal is £10.",
		},
		{
			id: "id-check",
			question: "Do I need to show ID to hire?",
			// [H2] [H3] [H1] [H4]
			answer:
				"No. Clients pay by card or from their wallet, with no ID check. People who take on " +
				"project work are checked instead. Stripe checks a person's photo ID and bank details " +
				"first. Only then can they take paid project work, join a team or withdraw earnings. A " +
				"business must be verified before it can spend from its shared business wallet.",
		},
		{
			id: "teams",
			question: "How do ready-made teams work?",
			// [A5] [A4] [A6] [N1]
			answer: "A ready-made team applies for a stage of your project as one unit. They work " +
				"together and get paid together. Every team that applies has at least two members, and " +
				"everyone paid from it is verified. When you approve a stage, the team's pay splits " +
				"automatically into each member's agreed share.",
		},
		{
			id: "no-show",
			question: "What if a live session doesn't happen?",
			// [J3] [J4] [J5] [J6] [J7]
			answer: "Report a no-show once the session has started, and within 24 hours of it ending. " +
				"The expert has 48 hours to reply. Then a Projective reviewer decides: pay the expert, " +
				"refund you, or split the payment. Cancel more than 24 hours before the session (for a " +
				"group, before its first session) and you get a full refund. Cancel later and the expert " +
				"keeps the payment.",
		},
	];
}
// #endregion
