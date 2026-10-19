import type { ComponentChildren, JSX } from "preact";
import {
	CALCULATOR_COPY,
	DEFAULT_PRICE_MINOR,
	formatPounds,
	formatPoundsShort,
	PRICING_COPY,
	QUICK_PICKS_MINOR,
	type StageSplit,
} from "@features/landing/core/pricing-calc.ts";

// #region Ids
/** The section's anchor (`flows/LANDING.md` §4.9; the header's "Pricing" link lands here). */
export const PRICING_SECTION_ID = "pricing";

/** The h2's id: the section is labelled by its one heading. */
export const PRICING_TITLE_ID = "pricing-title";

/** The calculator's element ids: one calculator on the page. */
export const CALC_IDS = {
	input: "pricing-calc-price",
	prefix: "pricing-calc-prefix",
	hint: "pricing-calc-hint",
	picks: "pricing-calc-picks",
	state: "pricing-calc-state",
} as const;
// #endregion

// #region Section
/** The platform fee as the section prints it. */
export interface PricingFee {
	/** Basis points from the server (`platform_fee_bp`). */
	bp: number;
	/** The same, formatted on the server ("5%"). */
	label: string;
}

/** Props for {@link PricingSection}. */
export interface PricingSectionProps {
	/** The fee, or `null` when it is unavailable: then every fee clause and the calculator drop. */
	fee: PricingFee | null;
	/**
	 * The calculator island. With a fee it is the panel's body; without one it draws nothing and is
	 * placed as is, so the section's stylesheet still reaches the page.
	 */
	calculator: ComponentChildren;
}

/**
 * PricingSection — `#pricing` as the server renders it (`flows/LANDING.md` §2.1 notes 21–22, §2.2
 * note 21, §2.3 note 20, §4.9; claims C1–C7, E1, N9). On its own warm editorial band: the section
 * header, the serif display h2 "A {fee} fee. You pay the price you see." (each sentence its own
 * line), the lead, then the worked example (C4) and the rounding example (C5), both computed with
 * `platformFeeFor` and visible with no JavaScript. Beside them, the calculator panel: the island's
 * field and rows, then the three notes. Without a fee the h2 keeps only "You pay the price you
 * see.", and the examples, the panel and its notes are omitted (§4 "If the fee is unavailable").
 */
export function PricingSection({ fee, calculator }: PricingSectionProps): JSX.Element {
	return (
		<section id={PRICING_SECTION_ID} class="lp-pricing" aria-labelledby={PRICING_TITLE_ID}>
			<div class={fee ? "lp-pricing__inner lp-pricing__inner--calc" : "lp-pricing__inner"}>
				<div class="lp-pricing__copy">
					<p class="lp-eyebrow lp-eyebrow--editorial">{PRICING_COPY.eyebrow}</p>
					<h2
						id={PRICING_TITLE_ID}
						class="lp-display lp-display--section lp-display--editorial lp-pricing__title"
					>
						{fee && <span class="lp-pricing__line">{PRICING_COPY.headingFee(fee.label)}</span>}
						{fee && " "}
						<span class="lp-pricing__line">{PRICING_COPY.headingPrice}</span>
					</h2>
					<p class="lp-lead lp-pricing__body">{PRICING_COPY.body.join(" ")}</p>
					{fee && (
						<div class="lp-pricing__examples">
							<p class="lp-body lp-pricing__example">
								{PRICING_COPY.workedExample(fee.label, fee.bp)}
							</p>
							<p class="lp-body lp-pricing__example">{PRICING_COPY.roundingExample(fee.bp)}</p>
						</div>
					)}
				</div>
				{fee
					? (
						<div class="lp-calc">
							{calculator}
							<ul class="lp-meta lp-calc__notes">
								{PRICING_COPY.notes.map((note) => <li key={note}>{note}</li>)}
							</ul>
						</div>
					)
					: calculator}
			</div>
		</section>
	);
}
// #endregion

// #region Calculator
/** What the calculator shows: the rows, or the message for an empty or unusable field. */
export type CalculatorState = "ok" | "empty" | "invalid";

/** Props for {@link PricingCalculatorView}. */
export interface PricingCalculatorViewProps {
	/** The fee formatted on the server ("5%"), for the fee row's label. */
	feeLabel: string;
	/** The field's text, as typed. */
	text: string;
	/** What the field holds. */
	state: CalculatorState;
	/** The rows' figures: the field's price when `state` is `ok`, else the last one worked out. */
	split: StageSplit;
	/**
	 * The island has hydrated. Until then — and for good with no JavaScript — the field, the
	 * steppers and the quick picks are not shown, since nothing would answer them (gate 11): the
	 * panel reads as the £2,000 worked example in text ("Stage price £2,000" over the rows). The two
	 * share one grid cell, so the controls appearing moves nothing.
	 */
	live: boolean;
	/** The polite live region's words: "You pay £2,000. The team receives £1,900." */
	announcement: string;
	onText?: (text: string) => void;
	onSettle?: () => void;
	onStep?: (direction: 1 | -1) => void;
	onPick?: (minor: number) => void;
}

/**
 * PricingCalculatorView — the calculator's body (§4.9; §2.1 note 22): the "Stage price" field with
 * its "£" prefix and two steppers inside one contour, the hint, the quick picks, then the rows —
 * You pay · "From the team's payment:" · Projective fee ({fee}) · The team receives — or, in the
 * same cell, the empty or invalid message; and the polite live region. Before hydration (and with
 * no JavaScript) the controls' cell shows the default price as text instead, holding the controls'
 * room so nothing shifts when they appear. No fill anywhere: no money moves (Decision #288 (E)).
 */
export function PricingCalculatorView(
	{ feeLabel, text, state, split, live, announcement, onText, onSettle, onStep, onPick }:
		PricingCalculatorViewProps,
): JSX.Element {
	const described = state === "ok"
		? `${CALC_IDS.prefix} ${CALC_IDS.hint}`
		: `${CALC_IDS.prefix} ${CALC_IDS.hint} ${CALC_IDS.state}`;
	return (
		<div class="lp-calc__body">
			<div class="lp-calc__controls" data-live={live ? "" : undefined}>
				<div class="lp-calc__static" aria-hidden={live ? "true" : undefined}>
					<p class="lp-calc__label">{CALCULATOR_COPY.label}</p>
					<p class="lp-calc__static-price">{formatPoundsShort(DEFAULT_PRICE_MINOR)}</p>
				</div>
				<div class="lp-calc__live">
					<label class="lp-calc__label" for={CALC_IDS.input}>{CALCULATOR_COPY.label}</label>
					<div class="lp-calc__field">
						<span id={CALC_IDS.prefix} class="lp-calc__prefix">{CALCULATOR_COPY.prefix}</span>
						<input
							id={CALC_IDS.input}
							class="lp-calc__input"
							type="text"
							inputMode="decimal"
							autoComplete="off"
							spellcheck={false}
							value={text}
							aria-invalid={state === "invalid" ? "true" : undefined}
							aria-describedby={described}
							onInput={(event) => onText?.(event.currentTarget.value)}
							onBlur={() => onSettle?.()}
						/>
						<button
							type="button"
							class="lp-calc__step"
							aria-label={CALCULATOR_COPY.stepDown}
							onClick={() => onStep?.(-1)}
						>
							−
						</button>
						<button
							type="button"
							class="lp-calc__step"
							aria-label={CALCULATOR_COPY.stepUp}
							onClick={() => onStep?.(1)}
						>
							+
						</button>
					</div>
					<p id={CALC_IDS.hint} class="lp-meta lp-calc__hint">{CALCULATOR_COPY.hint}</p>
					<div class="lp-calc__picks" role="group" aria-labelledby={CALC_IDS.picks}>
						<span id={CALC_IDS.picks} class="lp-calc__picks-label">{CALCULATOR_COPY.picks}</span>
						{QUICK_PICKS_MINOR.map((minor, index) => (
							<span key={minor}>
								{index > 0 && <span class="lp-calc__dot" aria-hidden="true">·</span>}
								<button
									type="button"
									class="lp-calc__pick"
									onClick={() => onPick?.(minor)}
								>
									{formatPoundsShort(minor)}
								</button>
							</span>
						))}
					</div>
				</div>
			</div>
			<div class="lp-calc__results" data-state={state}>
				<div class="lp-calc__rows" aria-hidden={state === "ok" ? undefined : "true"}>
					<dl class="lp-calc__list">
						<div class="lp-calc__row lp-calc__row--key">
							<dt>{CALCULATOR_COPY.youPay}</dt>
							<dd>{formatPounds(split.priceMinor)}</dd>
						</div>
					</dl>
					<p class="lp-meta lp-calc__sub">{CALCULATOR_COPY.fromTeam}</p>
					<dl class="lp-calc__list">
						<div class="lp-calc__row">
							<dt>{CALCULATOR_COPY.feeRow(feeLabel)}</dt>
							<dd>{split.feeMinor > 0 ? `−${formatPounds(split.feeMinor)}` : formatPounds(0)}</dd>
						</div>
						<div class="lp-calc__row lp-calc__row--key lp-calc__row--net">
							<dt>{CALCULATOR_COPY.teamReceives}</dt>
							<dd>{formatPounds(split.netMinor)}</dd>
						</div>
					</dl>
				</div>
				{state !== "ok" && (
					<p id={CALC_IDS.state} class="lp-calc__state">
						{state === "empty" ? CALCULATOR_COPY.empty : CALCULATOR_COPY.invalid}
					</p>
				)}
			</div>
			<p class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				{announcement}
			</p>
		</div>
	);
}
// #endregion
