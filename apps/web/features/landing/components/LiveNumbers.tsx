import type { JSX } from "preact";
import type { PublicMetrics } from "@projective/types/marketing";
import { currencyExponent } from "@projective/types/finance";
import {
	formatAsOf,
	formatMetricCount,
	formatMetricMoney,
	type PrintedFigure,
} from "@features/marketing/about/core/metric-format.ts";

// #region Copy
/** The section's anchor (`flows/LANDING.md` §4.7). */
export const NUMBERS_SECTION_ID = "numbers";

/** The h2's id: the section is labelled by its one heading. */
export const NUMBERS_TITLE_ID = "numbers-title";

/**
 * The section's words (§4.7; claims Y1–Y4). The protected total is published floored to two
 * significant figures (Decision #277 (C), flag (i)), so it is printed as the floor it is: "At
 * least", which stays true when the total is exactly that amount (where "Over" would not).
 */
export const LIVE_NUMBERS_COPY = {
	heading: "The numbers so far",
	/** Y4, with `{asOf}` as a UTC date ("17 Oct 2026"). */
	subline: "Counted from real payments on Projective",
	asOf: "as of",
	floor: "At least",
	/** Y1. */
	protected: "Money protected so far",
	/** Y2, and its footnote, P4's definition (approved or paid, with money released to a payee). */
	stages: "Stages delivered",
	stagesFoot: "Approved and paid out.",
	/** Y3: a median over approved stages only, so the label never speaks for every stage. */
	median: "Half of approved stages were approved within this time of being paid for.",
} as const;
// #endregion

// #region Tiles
/** Which figure a tile prints. */
export type LiveNumberKey = "protected" | "stages" | "median";

/** One printed figure of the section. */
export interface LiveNumberTile {
	key: LiveNumberKey;
	/** A word set above the digits ("At least"), if the figure is a floor. */
	qualifier?: string;
	/** The digits, with the exact words a screen reader hears when they abbreviate. */
	figure: PrintedFigure;
	/** A unit set small after the digits ("hours"). */
	unit?: string;
	label: string;
	/** A meta footnote under the label. */
	foot?: string;
}

/**
 * A median in hours as "within" reads it: rounded UP to the whole hour, never below one, so "half
 * were approved within 37 hours" stays true of a 36.1-hour median. The service publishes the
 * median to 0.1 h; the rounding to tenths first keeps float noise from adding an hour.
 */
export function withinHours(hours: number): { value: string; unit: "hour" | "hours" } {
	const whole = Math.max(1, Math.ceil(Math.round(hours * 10) / 10));
	return { value: formatMetricCount(whole), unit: whole === 1 ? "hour" : "hours" };
}

/** `asOf` as the UTC date the subline prints ("17 Oct 2026"), or `""` when it does not parse. */
export function asOfDate(iso: string): string {
	return formatAsOf(iso).split(",")[0] ?? "";
}

/**
 * The tiles for a metrics answer, in row order (§4.7). A figure the service withheld (`null`, below
 * its threshold) has no tile, and neither has one that would print as nothing — a 0 never shows,
 * nor a dash or an estimate. Money keeps its own currency and is printed by `/about`'s formatter
 * (whole units, rounded down; compact above a million). A total the service CONVERTED — escrows in
 * several currencies summed at reference rates (`converted: true`) — has no tile either: Y1 prints
 * an unconverted total only, never an "approx." one (§4.7, §5.1; Decision #277 flag (c)).
 */
export function liveNumberTiles(metrics: PublicMetrics): LiveNumberTile[] {
	const tiles: LiveNumberTile[] = [];
	const total = metrics.totalValueProtected;
	if (
		total && !total.converted &&
		Math.floor(total.amountMinor / 10 ** currencyExponent(total.currency)) >= 1
	) {
		tiles.push({
			key: "protected",
			qualifier: LIVE_NUMBERS_COPY.floor,
			figure: formatMetricMoney(total.amountMinor, total.currency),
			label: LIVE_NUMBERS_COPY.protected,
		});
	}
	if (metrics.stagesDelivered !== null && metrics.stagesDelivered >= 1) {
		tiles.push({
			key: "stages",
			figure: { text: formatMetricCount(metrics.stagesDelivered) },
			label: LIVE_NUMBERS_COPY.stages,
			foot: LIVE_NUMBERS_COPY.stagesFoot,
		});
	}
	const median = metrics.medianFundingToApprovalHours;
	if (median !== null && Number.isFinite(median)) {
		const hours = withinHours(median);
		tiles.push({
			key: "median",
			figure: { text: hours.value },
			unit: hours.unit,
			label: LIVE_NUMBERS_COPY.median,
		});
	}
	return tiles;
}
// #endregion

// #region Component
/** Props for {@link LiveNumbers}. */
export interface LiveNumbersProps {
	/**
	 * The public figures (`PublicMetricsService.get()`'s data), or `null` when the read was not ok —
	 * then the section is omitted, its h2 included.
	 */
	metrics: PublicMetrics | null;
}

/** One figure's digits: the abbreviation shown, the exact amount spoken. */
function Figure({ figure }: { figure: PrintedFigure }): JSX.Element {
	if (!figure.spoken) return <>{figure.text}</>;
	return (
		<>
			<span aria-hidden="true">{figure.text}</span>
			<span class="ui-visually-hidden">{figure.spoken}</span>
		</>
	);
}

/**
 * LiveNumbers — "The numbers so far", `#numbers` (`flows/LANDING.md` §2.1 note 18, §2.2 note 17,
 * §4.7; claims Y1–Y4; Decision #277). Up to three live figures from `PublicMetricsService` on the
 * warm editorial band, never boxed: money protected so far (as its floor), stages delivered and the
 * median hours from funding to approval, each hidden when the service withheld it; the h2 in the
 * section-header register and the subline with its UTC date. With no figure left — the read
 * failed, or every figure is below the threshold — it renders nothing at all. Static: no reveal and
 * no count-up (§2.7). Its stylesheet rides the PricingCalculator island, which `Pricing` always
 * mounts; this section renders only when the metrics read succeeded, so the fee is known then too.
 */
export function LiveNumbers({ metrics }: LiveNumbersProps): JSX.Element | null {
	const tiles = metrics ? liveNumberTiles(metrics) : [];
	if (!metrics || tiles.length === 0) return null;
	const date = asOfDate(metrics.asOf);
	return (
		<section id={NUMBERS_SECTION_ID} class="lp-numbers" aria-labelledby={NUMBERS_TITLE_ID}>
			<div class="lp-numbers__inner">
				<header class="lp-numbers__head">
					<h2 id={NUMBERS_TITLE_ID} class="lp-eyebrow lp-eyebrow--editorial lp-numbers__title">
						{LIVE_NUMBERS_COPY.heading}
					</h2>
					<p class="lp-body lp-numbers__note">
						{LIVE_NUMBERS_COPY.subline}
						{date
							? (
								<>
									, {LIVE_NUMBERS_COPY.asOf} <time dateTime={metrics.asOf}>{date}</time>.
								</>
							)
							: "."}
					</p>
				</header>
				<ul class="lp-numbers__list">
					{tiles.map((tile) => (
						<li key={tile.key} class={`lp-numbers__item lp-numbers__item--${tile.key}`}>
							{tile.qualifier && <span class="lp-numbers__qualifier">{tile.qualifier}</span>}
							<p class="lp-display lp-display--figure lp-numbers__figure">
								<Figure figure={tile.figure} />
								{tile.unit && <span class="lp-numbers__unit">{` ${tile.unit}`}</span>}
							</p>
							<div class="lp-numbers__words">
								<p class="lp-body lp-body--sm lp-numbers__label">{tile.label}</p>
								{tile.foot && <p class="lp-meta lp-numbers__foot">{tile.foot}</p>}
							</div>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

export default LiveNumbers;
// #endregion
