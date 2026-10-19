import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { DEMO_TABS } from "@features/landing/core/demo-stage.ts";
import {
	fairExitLines,
	JOURNEY,
	JOURNEY_LABEL,
	PAYMENTS_COPY,
	paymentsFrames,
	type PaymentsView,
	paymentsView,
	price,
	projectLine,
	STAGE_STATUS_LABEL,
	STAGE_STATUS_TONE,
} from "@features/landing/core/demos/payments-model.ts";

/**
 * PaymentsPicture — the Payment protection tab's drawn parts (`flows/LANDING.md` §4.4 "Payment
 * protection", §6 V2): the stages with their funding tags, the five stops, where the money is and the
 * Fair Exit results. Hook-free and fixture-pure, so the live demo, its frames and the stage's
 * server-rendered poster ({@link PaymentsPoster}) draw the same picture. Its stylesheet
 * (`styles/demos/payments.css`) arrives with the DemoHost island and with the demo's own chunk.
 */

// #region Constants
/** The money figures' fixed pins (§4: GBP, en-GB, no conversion table). */
export const MONEY = {
	currency: "GBP",
	displayCurrency: "GBP",
	locale: "en-GB",
	table: null,
} as const;
// #endregion

// #region Parts
/** Props for {@link Stages}. */
export interface StagesProps {
	view: PaymentsView;
	/** The stage a frame speaks about, marked in the picture. */
	focus?: string | null;
	/** The stage whose "Team paid" moment is playing. */
	celebrate?: string | null;
}

/**
 * The project's stages, in order: each one's name and price, and its lifecycle word on the product's
 * own funding tag (`.fst-tag`, `features/projects/styles/funding-status.css`) — Funded, Team paid or
 * Cancelled. A stage nothing is held for yet carries no tag.
 */
export function Stages({ view, focus = null, celebrate = null }: StagesProps): JSX.Element {
	return (
		<ol class="lp-pay__stages">
			{view.stages.map((stage) => (
				<li
					key={stage.id}
					class="lp-pay__stage"
					data-focus={focus === stage.id ? "" : undefined}
				>
					<span class="lp-pay__stage-name">{stage.name}</span>
					<span class="lp-pay__stage-price">{price(stage.priceMinor)}</span>
					<span class="lp-pay__stage-status">
						{stage.status
							? (
								<span
									key={stage.status}
									class="fst-tag lp-pay__tag"
									data-tone={STAGE_STATUS_TONE[stage.status]}
									data-celebrate={celebrate === stage.id && stage.status === "team_paid"
										? ""
										: undefined}
								>
									{STAGE_STATUS_LABEL[stage.status]}
								</span>
							)
							: null}
					</span>
				</li>
			))}
		</ol>
	);
}

/** Props for {@link Stops}. */
export interface StopsProps {
	stop: number;
	/** Live mode: the slider under it is the control, so this is its picture. */
	decorative?: boolean;
}

/** The five stops, the ones reached marked and the current one named; a readable list in frame mode. */
export function Stops({ stop, decorative = false }: StopsProps): JSX.Element {
	return (
		<ol
			class="lp-pay__stops"
			aria-hidden={decorative ? "true" : undefined}
			aria-label={decorative ? undefined : PAYMENTS_COPY.scrubber}
			data-stop={stop}
		>
			{JOURNEY.map((id, index) => (
				<li
					key={id}
					class="lp-pay__stop"
					data-reached={index <= stop ? "" : undefined}
					aria-current={!decorative && index === stop ? "step" : undefined}
				>
					{JOURNEY_LABEL[id]}
				</li>
			))}
		</ol>
	);
}

/** Props for {@link Ledger}. */
export interface LedgerProps {
	view: PaymentsView;
	feeBp: number | null;
}

/**
 * Where the money is: the client's wallet, and the team's side — Clearing · 7 days, then Available
 * (E1), then "Withdrawal started" once it is on its way to the bank (E2), each shown once it holds
 * something, so the team's payout is only ever in one place. The team's figures are after-fee
 * amounts, so without the fee they are not shown (§4).
 */
export function Ledger({ view, feeBp }: LedgerProps): JSX.Element {
	const team = view.team;
	return (
		<dl class="lp-pay__ledger">
			<div class="lp-pay__entry lp-pay__entry--wallet">
				<dt class="lp-pay__label">{PAYMENTS_COPY.wallet}</dt>
				<dd class="lp-pay__figure">
					<MoneyView {...MONEY} minor={view.walletMinor} size="key" />
				</dd>
			</div>
			{feeBp !== null && team.clearingMinor !== null && team.clearingMinor > 0
				? (
					<div class="lp-pay__entry">
						<dt class="lp-pay__label">{PAYMENTS_COPY.team} · {PAYMENTS_COPY.clearing}</dt>
						<dd class="lp-pay__figure">
							<MoneyView {...MONEY} minor={team.clearingMinor} size="key" />
						</dd>
					</div>
				)
				: null}
			{feeBp !== null && team.availableMinor !== null && team.availableMinor > 0
				? (
					<div class="lp-pay__entry">
						<dt class="lp-pay__label">{PAYMENTS_COPY.team} · {PAYMENTS_COPY.available}</dt>
						<dd class="lp-pay__figure">
							<MoneyView {...MONEY} minor={team.availableMinor} size="key" />
						</dd>
					</div>
				)
				: null}
			{feeBp !== null && team.withdrawingMinor !== null && team.withdrawingMinor > 0
				? (
					<div class="lp-pay__entry">
						<dt class="lp-pay__label">{PAYMENTS_COPY.team} · {PAYMENTS_COPY.withdrawal}</dt>
						<dd class="lp-pay__figure">
							<MoneyView {...MONEY} minor={team.withdrawingMinor} size="key" />
						</dd>
					</div>
				)
				: null}
		</dl>
	);
}

/** The Fair Exit result lines, F3 and F4. */
export function ExitResults({ view }: { view: PaymentsView }): JSX.Element | null {
	const lines = fairExitLines(view);
	if (!lines) return null;
	return (
		<div class="lp-pay__results">
			<p class="lp-pay__result">{lines.team}</p>
			<p class="lp-pay__result">{lines.back}</p>
		</div>
	);
}
// #endregion

// #region Poster
/** Props for {@link PaymentsPoster}. */
export interface PaymentsPosterProps {
	/** The platform fee in basis points from the server, or `null` (the team's figures hide). */
	feeBp: number | null;
}

/**
 * The tab's poster, rendered by the server (`flows/LANDING.md` §8: a real capture of the demo,
 * not a placeholder): the live demo's opening picture — Stage 1 paid for and held, the five stops
 * with "Held safely" reached, frame 1's words and the wallet — held still and `inert` inside a
 * `role="img"` named for the tab. The DemoHost island swaps it for the live demo once its chunk
 * arrives; with no JavaScript it is what the tab shows.
 */
export function PaymentsPoster({ feeBp }: PaymentsPosterProps): JSX.Element {
	const view = paymentsView({ stop: 0, fairExit: null }, feeBp);
	const lines = paymentsFrames(feeBp)[0].lines;
	return (
		<div class="lp-demo-poster" role="img" aria-label={DEMO_TABS.payments.posterLabel}>
			<div class="lp-demo-poster__still lp-pay" data-mode="live" inert>
				<div class="lp-pay__head">
					<p class="lp-pay__title">{projectLine()}</p>
				</div>
				<Stages view={view} />
				<div class="lp-pay__control lp-pay__scrubber">
					<Stops stop={view.stop} decorative />
				</div>
				<div class="lp-pay__body">
					<div class="lp-pay__story">
						<div class="lp-pay__now">
							{lines.map((line) => <p key={line} class="lp-pay__line">{line}</p>)}
						</div>
					</div>
					<Ledger view={view} feeBp={feeBp} />
				</div>
			</div>
		</div>
	);
}
// #endregion
