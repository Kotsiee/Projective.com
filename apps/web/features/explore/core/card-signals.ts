/**
 * Explore — pure derivation helpers shared by the discovery card family.
 *
 * Everything here is a projection over data the card already holds: no fetch, no clock injection at
 * the call site, no side effects. Kept out of the components so the Explore feed, the Profile tabs,
 * the `/view` rails and the marketing twins all resolve the same label from the same rule — a card
 * that says "Top rated" on one surface and nothing on another is a data question the reader cannot
 * answer.
 */
import type { DualRating, ProfileItem } from "../types/explore-types.ts";

// #region Languages
/**
 * ISO-639-1 → endonym-free English display name. The corpus stores short codes (`["EN","FR"]`) because
 * that is what a profile row will store, but a card must never print a code at the reader: "FR" is a
 * country to most people and a language to a few.
 */
const LANGUAGE_NAMES: Record<string, string> = {
	AR: "Arabic",
	DE: "German",
	EN: "English",
	ES: "Spanish",
	FR: "French",
	HI: "Hindi",
	IT: "Italian",
	JP: "Japanese",
	KR: "Korean",
	NL: "Dutch",
	PT: "Portuguese",
	SV: "Swedish",
	TR: "Turkish",
	ZH: "Mandarin",
};

/** The resolved display name for one language code, falling back to the code itself when unmapped. */
export function languageName(code: string): string {
	return LANGUAGE_NAMES[code.toUpperCase()] ?? code;
}

/**
 * The card's language line: the first `max` languages by name, then a `+N more` remainder.
 *
 * The remainder is a COUNT, never a truncated name — "English, German, +3 more" tells the reader
 * exactly how much they are not being shown, where "English, German, Fren…" tells them nothing and
 * looks like a rendering bug.
 */
export function languageSummary(codes: readonly string[] | undefined, max = 2): string {
	if (!codes?.length) return "";
	const shown = codes.slice(0, max).map(languageName);
	const rest = codes.length - shown.length;
	return rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
}
// #endregion

// #region Trust chips
/** One derived trust marker rendered in a card's top-left overlay stack. */
export interface CardSignal {
	/** Stable key — also the `data-signal` hook the stylesheet tints on. */
	id: "top-rated" | "fast-replies" | "available";
	label: string;
}

/** A helper rating this strong, over a sample this large, is the "Top rated" threshold. */
const TOP_RATED_VALUE = 4.9;
const TOP_RATED_MIN_SAMPLE = 20;
/** Under an hour to first reply is the "Fast replies" threshold. */
const FAST_REPLY_MINUTES = 60;
/** Booking load under this is genuinely open for new work. */
const AVAILABLE_LOAD = 60;

/**
 * The trust chips a profile-shaped card has actually earned, most-load-bearing first and capped at two
 * (a stack of badges reads as marketing, not as signal).
 *
 * Each is gated on a real datum: the rating track for "Top rated", the measured `responseMinutes` for
 * "Fast replies", the booking load for "Available now". A missing datum yields NO chip — it never
 * falls back to a neighbouring signal, because "fast replies" inferred from spare capacity is a
 * promise about a different thing.
 */
export function profileSignals(item: ProfileItem): CardSignal[] {
	const out: CardSignal[] = [];
	const helper = item.rating?.asHelper;
	if (helper && helper.value >= TOP_RATED_VALUE && helper.count >= TOP_RATED_MIN_SAMPLE) {
		out.push({ id: "top-rated", label: "Top rated" });
	}
	if (typeof item.responseMinutes === "number" && item.responseMinutes <= FAST_REPLY_MINUTES) {
		out.push({ id: "fast-replies", label: "Fast replies" });
	} else if (item.workload && item.workload.level < AVAILABLE_LOAD) {
		out.push({ id: "available", label: "Available now" });
	}
	return out.slice(0, 2);
}
// #endregion

/**
 * The trust chips a LISTING (a service or a digital product) has earned.
 *
 * A listing has one signal available to it — how it was rated — so this is the rating gate alone,
 * sharing the profile card's thresholds so "Top rated" means the same thing wherever it appears. A
 * listing with no ratings, or too few to be meaningful, gets no chip rather than a softer one.
 */
export function ratingSignals(rating: DualRating | undefined): CardSignal[] {
	const helper = rating?.asHelper ?? rating?.asClient;
	if (helper && helper.value >= TOP_RATED_VALUE && helper.count >= TOP_RATED_MIN_SAMPLE) {
		return [{ id: "top-rated", label: "Top rated" }];
	}
	return [];
}
// #endregion

// #region Relative time
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A compact relative age for a posting date — `3h`, `3 days`, `2 months`.
 *
 * `now` is a parameter with a default rather than a bare `Date.now()` read, so the formatting is a
 * pure function a test can pin. A future or unparseable date returns an empty string: a card would
 * rather print no timestamp than "in -1 days".
 */
export function relativeAge(iso: string, now: number = Date.now()): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const delta = now - then;
	if (delta < 0) return "";
	if (delta < HOUR) {
		const m = Math.max(1, Math.round(delta / MINUTE));
		return `${m}m`;
	}
	if (delta < DAY) return `${Math.round(delta / HOUR)}h`;
	const days = Math.round(delta / DAY);
	if (days < 31) return `${days} ${days === 1 ? "day" : "days"}`;
	const months = Math.round(days / 30);
	if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
	const years = Math.floor(days / 365);
	return `${years} ${years === 1 ? "year" : "years"}`;
}

/** The project card's header timestamp — `Posted 3 days ago`, or `""` when the date is unusable. */
export function postedLabel(iso: string, now: number = Date.now()): string {
	const age = relativeAge(iso, now);
	return age ? `Posted ${age} ago` : "";
}
// #endregion

// #region Metric stack
/** One right-aligned key metric in a profile card's footer. */
export interface CardMetric {
	value: string;
	label: string;
}

/**
 * The profile card's stacked footer metrics — catalogue depth for a freelancer, headcount for a team
 * or business. A zero is omitted rather than printed: "0 products" is a weaker statement than the
 * absence of the row, and it costs a line either way.
 */
export function profileMetrics(item: ProfileItem): CardMetric[] {
	if (item.type === "teams" || item.type === "businesses") {
		const n = item.members ?? 0;
		return n ? [{ value: String(n), label: n === 1 ? "member" : "members" }] : [];
	}
	const out: CardMetric[] = [];
	const services = item.servicePrices?.length ?? 0;
	if (services) {
		out.push({ value: String(services), label: services === 1 ? "service" : "services" });
	}
	const products = item.products ?? 0;
	if (products) {
		out.push({ value: String(products), label: products === 1 ? "product" : "products" });
	}
	return out;
}
// #endregion

// #region Service delivery model
/**
 * Natural-language labels for the five delivery models, used by the service card's uppercase type
 * chip. A map rather than `${serviceType} service`, which produces "GROUP SESSION SERVICE" and
 * "DIRECT DELIVERABLE SERVICE" — long enough to truncate in the slot, and redundant besides.
 */
const SERVICE_TYPE_LABELS: Record<string, string> = {
	"Pipeline": "Pipeline service",
	"One-Off": "One-off service",
	"Direct Deliverable": "Direct deliverable",
	"Session": "1:1 session",
	"Group Session": "Group session",
};

/** The service card's delivery-model chip label (rendered uppercase + tracked by the stylesheet). */
export function serviceTypeLabel(serviceType: string): string {
	return SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}
// #endregion
