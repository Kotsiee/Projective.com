import type { PublicMetrics } from "@projective/types/marketing";
import { currencyExponent } from "@projective/types/finance";

/**
 * metric-format — how `/about` prints the live platform figures (Decision #277). Pure and
 * deterministic (fixed locale, UTC), so the server render and any later client render agree, and
 * every rule is unit-tested. Presentation only: the figures arrive computed and thresholded from
 * `PublicMetricsService`; nothing here decides whether a figure may be shown, only how it reads.
 *
 * Money is always rounded DOWN for display — a public total may understate, never overstate.
 */

/** The locale every public figure is printed in (the site's default). */
export const METRIC_LOCALE = "en-GB";

// #region Money
/** A figure as printed, plus the words a screen reader should hear when the print is abbreviated. */
export interface PrintedFigure {
	text: string;
	/** Present only when `text` abbreviates (`£12.3M` → `£12,345,678`). */
	spoken?: string;
}

function currencyFormat(
	currency: string,
	options: Intl.NumberFormatOptions,
): Intl.NumberFormat | null {
	try {
		return new Intl.NumberFormat(METRIC_LOCALE, {
			style: "currency",
			currency: currency.toUpperCase(),
			...options,
		});
	} catch {
		return null;
	}
}

/**
 * A money total in whole units of its currency, rounded down: exact with grouping below a million
 * (`$151,000`), three significant figures in compact notation above it, floored first so the
 * abbreviation never rounds up (`£12,389,000` → `£12.3M`, spoken as the exact whole amount).
 */
export function formatMetricMoney(amountMinor: number, currency: string): PrintedFigure {
	const code = currency.toUpperCase();
	const major = Math.floor(Math.max(0, amountMinor) / 10 ** currencyExponent(code));
	const exact = currencyFormat(code, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	const exactText = exact ? exact.format(major) : `${major.toLocaleString(METRIC_LOCALE)} ${code}`;
	if (major < 1_000_000) return { text: exactText };
	const step = 10 ** (Math.floor(Math.log10(major)) - 2);
	const floored = Math.floor(major / step) * step;
	const compact = currencyFormat(code, {
		notation: "compact",
		compactDisplay: "short",
		maximumSignificantDigits: 3,
	});
	return compact ? { text: compact.format(floored), spoken: exactText } : { text: exactText };
}
// #endregion

// #region Counts, durations, rates, instants
/** A whole count with grouping (`1,204`). */
export function formatMetricCount(n: number): string {
	return new Intl.NumberFormat(METRIC_LOCALE, { maximumFractionDigits: 0 }).format(Math.floor(n));
}

/**
 * A median duration from hours: `Under an hour`, whole hours below two days (`36 hours`), then days
 * to one decimal place with a trailing `.0` dropped (`16.5 days`, `2 days`).
 */
export function formatMetricDuration(hours: number): string {
	if (!Number.isFinite(hours) || hours < 1) return "Under an hour";
	if (hours < 48) {
		const whole = Math.round(hours);
		return `${whole} ${whole === 1 ? "hour" : "hours"}`;
	}
	const days = Math.round((hours / 24) * 10) / 10;
	const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
	return `${text} days`;
}

/** A fee in basis points as a percentage: 500 → `5%`, 250 → `2.5%`, 125 → `1.25%`. */
export function formatFeePercent(bp: number): string {
	const pct = Math.round(bp) / 100;
	return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An instant as `17 Oct 2026, 21:07 UTC` — fixed to UTC so every render prints the same words. */
export function formatAsOf(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ` +
		`${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}
// #endregion

// #region Tiles
/** The tile keys, in the order the row prints them. */
export type MetricKey = "protected" | "stages" | "median" | "fee";

/** One printed tile of the live metrics row. */
export interface MetricTile {
	key: MetricKey;
	/** Section-caps label (sentence case; the stylesheet upper-cases it). */
	label: string;
	value: PrintedFigure;
	/** One meta sentence saying what the figure counts. */
	caption: string;
}

/** The three figures that can be withheld below the threshold, with the words a notice uses. */
const WITHHELD_NAME: Readonly<Record<Exclude<MetricKey, "fee">, string>> = {
	protected: "money protected",
	stages: "stages delivered",
	median: "the funding-to-approval time",
};

/**
 * The tiles `/about` prints for a metrics answer, in row order. A `null` figure (below the
 * threshold) has no tile at all — never a dash, a zero or an estimate. The fee always prints.
 */
export function aboutMetricTiles(metrics: PublicMetrics): MetricTile[] {
	const tiles: MetricTile[] = [];
	if (metrics.totalValueProtected) {
		tiles.push({
			key: "protected",
			label: "Money protected so far",
			value: formatMetricMoney(
				metrics.totalValueProtected.amountMinor,
				metrics.totalValueProtected.currency,
			),
			// The service publishes this total floored to two significant figures (Decision #277 (C)).
			caption:
				"Paid into escrow for a stage — held now, or released to the people who did the work. Rounded down.",
		});
	}
	if (metrics.stagesDelivered !== null) {
		tiles.push({
			key: "stages",
			label: "Stages delivered",
			value: { text: formatMetricCount(metrics.stagesDelivered) },
			caption: "Approved by the Client and paid out.",
		});
	}
	if (metrics.medianFundingToApprovalHours !== null) {
		tiles.push({
			key: "median",
			label: "Funding to approval",
			value: { text: formatMetricDuration(metrics.medianFundingToApprovalHours) },
			caption: "The median time from a stage being funded to the Client approving it.",
		});
	}
	tiles.push({
		key: "fee",
		label: "Platform fee",
		value: { text: formatFeePercent(metrics.platformFeeBp) },
		caption:
			"Taken from each payment as it's released. Card processing is passed through separately.",
	});
	return tiles;
}

/**
 * The one sentence that says which figures are withheld and why, or `null` when none is. Names
 * only the hidden ones, so the page never promises a figure it is already showing.
 */
export function withheldNotice(metrics: PublicMetrics): string | null {
	const hidden: string[] = [];
	if (!metrics.totalValueProtected) hidden.push(WITHHELD_NAME.protected);
	if (metrics.stagesDelivered === null) hidden.push(WITHHELD_NAME.stages);
	if (metrics.medianFundingToApprovalHours === null) hidden.push(WITHHELD_NAME.median);
	if (hidden.length === 0) return null;
	const list = hidden.length === 1
		? hidden[0]
		: `${hidden.slice(0, -1).join(", ")} and ${hidden[hidden.length - 1]}`;
	const subject = list.charAt(0).toUpperCase() + list.slice(1);
	const verb = hidden.length === 1 ? "appears" : "appear";
	const rest = hidden.length === 1 ? "it rests" : "each rests";
	return `${subject} ${verb} here once ${rest} on at least ${
		formatMetricCount(metrics.minN)
	} records — we don't publish figures too small to mean anything.`;
}
// #endregion
