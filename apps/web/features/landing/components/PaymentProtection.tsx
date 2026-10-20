import type { JSX } from "preact";
import {
	fairExitSplit,
	feeRate,
	JOURNEY,
	JOURNEY_LABEL,
	type JourneyStop,
	PAYMENTS_COPY,
	PAYMENTS_FIXTURE,
	price,
} from "@features/landing/core/demos/payments-model.ts";

// #region Copy
/** One point of a section: its h3 and the body under it. */
export interface SectionPoint {
	title: string;
	body: string;
}

/**
 * "Payment protection" (`flows/LANDING.md` §4.6), verbatim. The explainer line is the one place
 * the page body says "escrow" (Decision #283 (C)); nothing here says the team is paid "only" or
 * "until" you approve (Decision #281), and nothing names a fee figure — those come from the server's
 * rate in {@link protectionFlow}.
 */
export const PROTECTION_COPY = {
	eyebrow: "Payment protection",
	/** `[B1]` `[A2]` */
	title: "Money held safely, stage by stage.",
	/** `[B5]` */
	explainer:
		"This is payment protection (escrow): when you pay for a stage, the money is held safely before any work starts.",
	points: [
		{
			title: "Held before work starts",
			/** `[B3]` `[B4]` */
			body:
				"Work only starts once the stage is paid for. Until then, the task can't move into work.",
		},
		{
			title: "Paid when you approve",
			/** `[B2]` */
			body: "The team is paid when you accept their work or approve the stage.",
		},
		{
			title: "A fair way out",
			/** `[F1]` `[F2]` `[F4]` */
			body:
				"If work stops, end the stage with Fair Exit. You pick how much was done: 25%, 50% or 75%. The rest comes straight back to you, fee-free.",
		},
		{
			title: "Missed sessions",
			/** `[J3]` `[J5]` */
			body:
				"Booked a live session that didn't happen? Report a no-show, and a Projective reviewer decides.",
		},
		{
			title: "Checked before they take on project work",
			/** `[H1]` */
			body:
				"Stripe checks a person's photo ID and bank details first. Only then can they take paid project work, join a team or withdraw earnings.",
		},
		{
			title: "Clears in 7 days",
			/** `[E1]` `[E2]` */
			body: "When you approve, the team's money clears in 7 days. Then they can withdraw it.",
		},
		{
			title: "Refunds without fees",
			/** `[G1]` */
			body: "Refunds go straight back into your Projective wallet, with no fee.",
		},
		{
			/** `[I1]` */
			title: "Every penny on record",
			/** `[I1]` `[I2]` `[I3]` */
			body:
				"Every change to a wallet balance is written to a log that can't be edited or deleted. Balances are checked against it every night. Each payment goes out once, never twice.",
		},
	] satisfies readonly SectionPoint[],
	helpLink: "Get help with payments",
	helpHref: "/help",
	termsLink: "Read the payment protection terms",
} as const;

/** The section's anchor. */
export const PROTECTION_SECTION_ID = "payment-protection";

/** The h2's id: the section is labelled by it. */
export const PROTECTION_TITLE_ID = "payment-protection-title";
// #endregion

// #region The flow
/** One stop on the figure's rail: the payment protection example's own label, and its note. */
export interface ProtectionStop {
	id: JourneyStop;
	label: string;
	/** A clause under the label, or `null`. */
	note: string | null;
}

/** The figure: the money's five stops, then the Fair Exit example when the fee is known. */
export interface ProtectionFlow {
	stops: ProtectionStop[];
	/** "Fair Exit on a £2,000 stage" and its split at 50% `[F5]`; `null` without the fee (§4). */
	fairExit: { label: string; figures: string } | null;
}

/**
 * The figure's words, from the payment protection example (`core/demos/payments-model.ts`): its
 * five stops in order (Held safely → You approve → Team paid → Clears in 7 days → Withdraw to bank,
 * §4.4), "Held safely" noted with when (`[B5]`) and "Team paid" with the fee (`[C1]`), and Fair Exit
 * at 50% on the example's £2,000 stage, mirrored from `fn_fair_exit_split` (`[F5]`: the fee on the
 * earned share only, the rest back fee-free). The rate is the server's `platform_fee_bp`, never a
 * literal: with no rate (`null`) the fee clause drops and the Fair Exit example is not shown
 * (`flows/LANDING.md` §4 "If the fee is unavailable").
 */
export function protectionFlow(feeBp: number | null): ProtectionFlow {
	const note: Partial<Record<JourneyStop, string>> = {
		held: "before any work starts",
		...(feeBp === null ? {} : { paid: `minus the ${feeRate(feeBp)} fee` }),
	};
	const stage = PAYMENTS_FIXTURE.stages[1];
	const exit = feeBp === null ? null : fairExitSplit(stage.priceMinor, 50, feeBp);
	const currency = PAYMENTS_FIXTURE.currency;
	return {
		stops: JOURNEY.map((id) => ({ id, label: JOURNEY_LABEL[id], note: note[id] ?? null })),
		fairExit: exit === null ? null : {
			label: `Fair Exit on a ${price(stage.priceMinor, currency)} stage`,
			figures: `At 50%: the team gets ${price(exit.payoutMinor, currency)}. You get ${
				price(exit.refundMinor, currency)
			} back, fee-free.`,
		},
	};
}

/** Props for {@link ProtectionFigure}. */
interface ProtectionFigureProps {
	flow: ProtectionFlow;
}

/**
 * The section's figure (`flows/LANDING.md` §2.1 note 17, §2.2 note 16, §2.3 notes 15–16): an
 * exhibit drawn on the band, never boxed — its caption, the five stops as an ordered list on one
 * spine (the rail; down the page on a phone and beside the text from 1280px, across it between),
 * then the Fair Exit example under its own hairline. Real text, so it reads in order and zooms.
 */
function ProtectionFigure({ flow }: ProtectionFigureProps): JSX.Element {
	return (
		<figure class="lp-section__figure lp-protect__figure" aria-labelledby="payment-protection-flow">
			<figcaption id="payment-protection-flow" class="lp-eyebrow lp-eyebrow--editorial">
				{PAYMENTS_COPY.scrubber}
			</figcaption>
			<ol class="lp-protect__rail">
				{flow.stops.map((stop) => (
					<li
						key={stop.id}
						class={`lp-protect__stop${stop.id === "held" ? " lp-protect__stop--held" : ""}`}
					>
						<span class="lp-protect__dot" aria-hidden="true" />
						<span class="lp-protect__stop-name">{stop.label}</span>
						{stop.note ? <span class="lp-meta lp-protect__stop-note">{stop.note}</span> : null}
					</li>
				))}
			</ol>
			{flow.fairExit
				? (
					<div class="lp-protect__exit">
						<p class="lp-eyebrow lp-eyebrow--editorial">{flow.fairExit.label}</p>
						<p class="lp-body lp-protect__exit-figures">{flow.fairExit.figures}</p>
					</div>
				)
				: null}
		</figure>
	);
}
// #endregion

// #region Component
/** Props for {@link PaymentProtection}. */
export interface PaymentProtectionProps {
	/**
	 * The payment protection terms (`/legal/escrow-terms`, the legal hub's page), or `null` while the
	 * version in effect is an unreviewed draft (`protectionTermsHref`, `flows/LANDING.md` §9 row 8) —
	 * then "Read the payment protection terms" is not rendered.
	 */
	termsHref: string | null;
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`).
	 * Absent or `null`, every fee clause drops: the figure's "Team paid" carries no fee and its
	 * Fair Exit example is not shown (`flows/LANDING.md` §4). Never hard-coded.
	 */
	feeBp?: number | null;
}

/**
 * PaymentProtection — the trust section, `#payment-protection` (`flows/LANDING.md` §2.1 notes 16–17,
 * §2.2 notes 15–16, §2.3 notes 15–16, §4.6), in the secondary editorial voice: a solid warm band
 * (`--lp-warm-bg`, full-bleed), the serif display at `--fw-medium` (Decision #288), sans body.
 *
 * The section header, the h2 and the explainer line — the one "payment protection (escrow)" in the
 * page body (Decision #283 (C)) — then the eight points as one column of labelled rows, a ledger
 * (the h3 a label beside its body from `--bp-md`, one hairline each; never a grid of features, so
 * it reads apart from "For freelancers and teams"), the money's rail ({@link ProtectionFigure}) and
 * the links: "Get help with payments" (`/help`) and, once a lawyer has reviewed the terms in effect,
 * "Read the payment protection terms". Every sentence is a claims-table row (§5). From 1280px the
 * rail sits beside the ledger and stays in view while the rows pass (sticky, never scroll-linked).
 * Nothing animates here (§2.7). A server component with no island.
 */
export function PaymentProtection(
	{ termsHref, feeBp = null }: PaymentProtectionProps,
): JSX.Element {
	const flow = protectionFlow(feeBp);
	return (
		<section
			id={PROTECTION_SECTION_ID}
			class="lp-section lp-section--band lp-protect"
			aria-labelledby={PROTECTION_TITLE_ID}
		>
			<div class="lp-section__inner">
				<div class="lp-protect__layout">
					<header class="lp-section__head lp-protect__head">
						<p class="lp-eyebrow lp-eyebrow--editorial">{PROTECTION_COPY.eyebrow}</p>
						<h2
							id={PROTECTION_TITLE_ID}
							class="lp-display lp-display--section lp-display--editorial lp-section__title lp-protect__title"
						>
							{PROTECTION_COPY.title}
						</h2>
						<p class="lp-lead lp-section__lead">{PROTECTION_COPY.explainer}</p>
					</header>
					<ul class="lp-section__points lp-protect__points">
						{PROTECTION_COPY.points.map((point) => (
							<li key={point.title} class="lp-section__point">
								<h3 class="lp-heading">{point.title}</h3>
								<p class="lp-body lp-section__point-body">{point.body}</p>
							</li>
						))}
					</ul>
					<ProtectionFigure flow={flow} />
					<p class="lp-protect__links">
						<a class="lp-section__link" href={PROTECTION_COPY.helpHref}>
							{PROTECTION_COPY.helpLink}
						</a>
						{termsHref
							? <a class="lp-section__link" href={termsHref}>{PROTECTION_COPY.termsLink}</a>
							: null}
					</p>
				</div>
			</div>
		</section>
	);
}

export default PaymentProtection;
// #endregion
