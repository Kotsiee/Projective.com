/**
 * demo-stage — the demo stage's words and its pure helpers (`flows/LANDING.md` §2.1 notes 10–13,
 * §4.4; work order L3): which tab a URL asks for, the URL a tab writes, the tablist's roving keys,
 * the ids that tie a tab to its panel, and the fee as the copy prints it.
 *
 * Shared by the server (`components/DemoStage.tsx`, `routes/(public)/index.tsx`) and the DemoHost
 * island, so it holds no browser global and imports nothing that renders.
 */
import type { DemoId } from "./demos/demo-contract.ts";

// #region Tabs and the URL
/** The stage's tabs, in order (§4.4): Work board · Payment protection · Booking · Team pay. */
export const DEMO_IDS: readonly DemoId[] = ["board", "payments", "booking", "splits"];

/** The tab a page opens on when its URL names none (or names one that does not exist). */
export const DEFAULT_DEMO: DemoId = "board";

/** The query parameter that carries the open tab (`?demo=board|payments|booking|splits`). */
export const DEMO_PARAM = "demo";

/** The section's id: the anchor every "see it work" link lands on. */
export const DEMO_SECTION_ID = "demo";

/** Whether `value` names one of the stage's tabs. */
export function isDemoId(value: unknown): value is DemoId {
	return typeof value === "string" && (DEMO_IDS as readonly string[]).includes(value);
}

/** The tab a `?demo=` value asks for: an exact tab id, else {@link DEFAULT_DEMO}. */
export function parseDemoId(value: string | null | undefined): DemoId {
	return isDemoId(value) ? value : DEFAULT_DEMO;
}

/** The tab a URL asks for (its `?demo=` parameter). */
export function demoFromUrl(url: URL | string, base = "https://projective.invalid"): DemoId {
	const parsed = typeof url === "string" ? new URL(url, base) : url;
	return parseDemoId(parsed.searchParams.get(DEMO_PARAM));
}

/**
 * A link that opens `id` on the stage of the page at `path`: `/?demo=board#demo`. Without
 * JavaScript the server renders that tab (the thin controller reads `demo`).
 */
export function demoHref(id: DemoId, path = "/"): string {
	return `${path}?${DEMO_PARAM}=${id}#${DEMO_SECTION_ID}`;
}

/**
 * The address `history.replaceState` writes when the visitor opens `id`: `href`'s path, its other
 * query parameters and its hash kept, `demo` set — relative, so the page never navigates.
 */
export function urlWithDemo(href: string, id: DemoId): string {
	const url = new URL(href, "https://projective.invalid");
	url.searchParams.set(DEMO_PARAM, id);
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The tab a same-page link opens, or `null` when `href` is not one: it must point at `pagePath`,
 * name a tab in `?demo=` and land on `#demo` (`/?demo=board#demo`, the hero's "Try it yourself").
 */
export function samePageDemoLink(href: string, pagePath: string): DemoId | null {
	let url: URL;
	try {
		url = new URL(href, `https://projective.invalid${pagePath}`);
	} catch {
		return null;
	}
	if (url.origin !== "https://projective.invalid" || url.pathname !== pagePath) return null;
	if (url.hash !== `#${DEMO_SECTION_ID}`) return null;
	const raw = url.searchParams.get(DEMO_PARAM);
	return isDemoId(raw) ? raw : null;
}

/** The ids that tie one tab to its panel and the panel to its description. */
export interface DemoDomIds {
	tab: string;
	panel: string;
	desc: string;
}

/** {@link DemoDomIds} for `id`. */
export function demoDomIds(id: DemoId): DemoDomIds {
	return { tab: `demo-tab-${id}`, panel: `demo-panel-${id}`, desc: `demo-desc-${id}` };
}

/**
 * Where the tablist's roving focus goes for `key` from the tab at `index` of `count` (manual
 * activation: arrows move focus and never open a tab, so arrowing never loads a chunk). Left and
 * Right wrap; Home and End jump to the ends; any other key is not the tablist's (`null`).
 */
export function tabFocusTarget(key: string, index: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case "ArrowRight":
			return (index + 1) % count;
		case "ArrowLeft":
			return (index - 1 + count) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
// #endregion

// #region Fee
/**
 * The platform fee as the copy prints it (`{platformFee}`, §4): basis points as a percentage with
 * no trailing zeros — 500 → "5%", 250 → "2.5%", 125 → "1.25%". Never hard-coded: the bp comes from
 * the server (`PublicMetricsService`).
 */
export function platformFeeLabel(feeBp: number): string {
	const percent = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(feeBp / 100);
	return `${percent}%`;
}
// #endregion

// #region Copy
/**
 * The stage's own words (§4.4). The stage note is always visible `[P9]`; the role note describes
 * the demos' controls.
 */
export const DEMO_STAGE_COPY = {
	eyebrow: "See it work",
	title: "See a project run, step by step.",
	/** `[P9]` */
	note: "Example only. No real money moves.",
	role: "You play both sides: the client pays and approves; the freelancer starts the work.",
	tablist: "Examples",
	/** "Start again": its visible words are its whole accessible name (WCAG 2.5.3, Decision #298). */
	reset: "Start again",
	more: "See everything Projective does",
	moreHref: "/features",
} as const;

/** One tab's words: its label, the caption under the viewport and its poster's name. */
export interface DemoTabCopy {
	label: string;
	/** Under 15 words (§4). */
	caption: string;
	/**
	 * The accessible name of the tab's poster: the server-rendered still of its demo's opening
	 * picture (§8), one `role="img"` until the demo is live.
	 */
	posterLabel: string;
}

/** Each tab's {@link DemoTabCopy} (§4.4, §8). */
export const DEMO_TABS: Readonly<Record<DemoId, DemoTabCopy>> = {
	board: {
		label: "Work board",
		/** `[B3]` `[D1]` */
		caption: "Work only starts once it's paid for. Approve, and it moves on.",
		/** §4.4 "Poster alt". */
		posterLabel: "Example work board with five columns.",
	},
	payments: {
		label: "Payment protection",
		/** `[B1]` `[B2]` */
		caption: "Your money is held safely. The team is paid when you approve.",
		posterLabel: "Payment protection example.",
	},
	booking: {
		label: "Booking",
		/** `[J8]` `[J10]` */
		caption: "Pick a time in your time zone. Moving a group session? Attendees vote.",
		posterLabel: "Booking example.",
	},
	splits: {
		label: "Team pay",
		/** `[N1]` */
		caption: "Approve a stage and the team's pay splits into each agreed share.",
		posterLabel: "Team pay example.",
	},
};

/** The board poster's accessible name (§4.4 "Poster alt"). */
export const BOARD_POSTER_LABEL: string = DEMO_TABS.board.posterLabel;

/**
 * A tab's crawlable description (§4.4 "SSR description"), the fee formatted from the server's bp.
 * With no fee every fee clause drops (§4 "If the fee is unavailable"), so the sentence ends where
 * the team is paid.
 */
export function demoDescription(id: DemoId, feeBp: number | null): string {
	const fee = feeBp === null ? null : platformFeeLabel(feeBp);
	switch (id) {
		case "board":
			// `[K1]` `[K3]` `[D1]`
			return "Every job you post runs on a board. Work only starts on a task once it's paid for. Approve a stage, and the task moves on to its next stage.";
		case "payments":
			// `[B6]` `[B3]` `[B2]` `[C1]`
			return `Follow a £5,000 project in three stages. Each stage's money is held safely before work starts. ${
				fee === null
					? "When you approve, the team is paid."
					: `When you approve, the team is paid, minus the ${fee} fee.`
			}`;
		case "booking":
			// `[J8]` `[J10]`
			return "Pick a session time from the freelancer's live availability, shown in your time zone. Moving a group session? Offer new times, and it moves only if more than half agree.";
		case "splits":
			// `[C1]` `[N1]` `[N4]`
			return `See a £2,000 stage payment reach a three-person team. ${
				fee === null
					? "The team's vault share comes off."
					: `The ${fee} fee comes off, then the team's vault share.`
			} The rest splits into each member's agreed share, to the penny.`;
	}
}
// #endregion
