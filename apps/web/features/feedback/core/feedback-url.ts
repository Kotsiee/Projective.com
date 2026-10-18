// The Zod-free sub-path, not the `community` barrel: this module rides in `FeedbackHost` and the
// account menu's bridge, which every public and dashboard page loads.
import {
	FEEDBACK_STATUS_FILTERS,
	type FeedbackSort,
	type FeedbackStatusFilter,
} from "@projective/types/community/feedback-constants";
import { isSlug } from "@projective/types/slugs";

/**
 * feedback-url — the feedback board's URL contract (Decision #272), in one pure module the page, the
 * drawer host and their tests share.
 *
 * - `?feedback=open` on any page opens the board in the drawer; `/feedback` is the board's own page.
 * - `idea=<fbk-slug>` opens one idea (in either mode); `compose=1` opens the suggestion form.
 * - `status=under_review|planned|in_progress|shipped` and `sort=top|new` filter the board. On
 *   `/feedback` they are written back as the reader changes tabs. In the drawer they are read on
 *   arrival only and never written: a host page owns those names (`/projects?status=`, the explore
 *   and wallet filters), and the drawer must leave the page's own address as it found it.
 *
 * Every write keeps the other parameters, in order, and the hash.
 */

/** The parameter that opens the drawer, and its one value. */
export const FEEDBACK_OVERLAY_PARAM = "feedback";
export const FEEDBACK_OVERLAY_VALUE = "open";
/** The board's own page. */
export const FEEDBACK_PATH = "/feedback";

/** What the board shows. */
export type FeedbackView = "board" | "idea" | "compose";

/** Where the board is, as the URL says. */
export interface FeedbackLocation {
	view: FeedbackView;
	/** The open idea's slug when `view` is `idea`. */
	idea: string | null;
	/** The status tab, or `null` for every tab at once. */
	status: FeedbackStatusFilter | null;
	sort: FeedbackSort;
}

/** The board with nothing chosen: every tab, most voted first. */
export const FEEDBACK_HOME: FeedbackLocation = Object.freeze({
	view: "board",
	idea: null,
	status: null,
	sort: "top",
});

function paramsOf(search: string | URLSearchParams): URLSearchParams {
	return typeof search === "string" ? new URLSearchParams(search) : search;
}

/** Read the board's location. An unknown tab or a malformed idea address reads as absent. */
export function readFeedbackLocation(search: string | URLSearchParams): FeedbackLocation {
	const params = paramsOf(search);
	const idea = params.get("idea");
	const status = params.get("status");
	return {
		view: idea && isSlug(idea, "idea")
			? "idea"
			: params.get("compose") === "1"
			? "compose"
			: "board",
		idea: idea && isSlug(idea, "idea") ? idea : null,
		status: (FEEDBACK_STATUS_FILTERS as readonly string[]).includes(status ?? "")
			? status as FeedbackStatusFilter
			: null,
		sort: params.get("sort") === "new" ? "new" : "top",
	};
}

/** Whether the URL asks for the drawer. */
export function isFeedbackOverlayOpen(search: string | URLSearchParams): boolean {
	return paramsOf(search).get(FEEDBACK_OVERLAY_PARAM) === FEEDBACK_OVERLAY_VALUE;
}

/** Whether the drawer may open on `pathname` — anywhere but the board's own page. */
export function feedbackOverlayAllowed(pathname: string): boolean {
	return pathname.replace(/\/+$/, "") !== FEEDBACK_PATH;
}

/** A query string as its raw `key=value` segments, so a host's own parameters keep their spelling. */
class RawQuery {
	private readonly segments: string[];

	constructor(query: string) {
		this.segments = query ? query.split("&").filter((seg) => seg.length > 0) : [];
	}

	private static keyOf(segment: string): string {
		const raw = segment.split("=")[0];
		try {
			return decodeURIComponent(raw.replace(/\+/g, " "));
		} catch {
			return raw;
		}
	}

	/** The decoded parameters (for reading). */
	params(): URLSearchParams {
		return new URLSearchParams(this.segments.join("&"));
	}

	/** Set or clear `key`: in place where it already is, appended otherwise; every other key verbatim. */
	put(key: string, value: string | null): void {
		const at = this.segments.findIndex((seg) => RawQuery.keyOf(seg) === key);
		const encoded = value === null
			? null
			: `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
		if (at === -1) {
			if (encoded) this.segments.push(encoded);
			return;
		}
		// Drop any duplicates of the key after its first position.
		for (let i = this.segments.length - 1; i > at; i--) {
			if (RawQuery.keyOf(this.segments[i]) === key) this.segments.splice(i, 1);
		}
		if (encoded) this.segments[at] = encoded;
		else this.segments.splice(at, 1);
	}

	toString(): string {
		return this.segments.join("&");
	}
}

function split(href: string): { path: string; query: RawQuery; hash: string } {
	const hashAt = href.indexOf("#");
	const hash = hashAt === -1 ? "" : href.slice(hashAt);
	const rest = hashAt === -1 ? href : href.slice(0, hashAt);
	const queryAt = rest.indexOf("?");
	return {
		path: queryAt === -1 ? rest : rest.slice(0, queryAt),
		query: new RawQuery(queryAt === -1 ? "" : rest.slice(queryAt + 1)),
		hash,
	};
}

function join(path: string, query: RawQuery, hash: string): string {
	const qs = query.toString();
	return `${path}${qs ? `?${qs}` : ""}${hash}`;
}

/** What a write may carry. */
export interface FeedbackHrefOptions {
	/** `true` adds `feedback=open`, `false` removes it, absent leaves it. */
	overlay?: boolean;
	/** Also write the tab and the order (the board's own page only). */
	filters?: boolean;
}

/**
 * The href for a location: `idea` / `compose` always, `status` / `sort` only with `filters` (the
 * defaults — every tab, Top — are left out of the URL).
 */
export function withFeedbackLocation(
	href: string,
	location: FeedbackLocation,
	options: FeedbackHrefOptions = {},
): string {
	const { path, query, hash } = split(href);
	if (options.overlay === true) query.put(FEEDBACK_OVERLAY_PARAM, FEEDBACK_OVERLAY_VALUE);
	if (options.overlay === false) query.put(FEEDBACK_OVERLAY_PARAM, null);
	query.put("idea", location.view === "idea" ? location.idea : null);
	query.put("compose", location.view === "compose" ? "1" : null);
	if (options.filters) {
		query.put("status", location.status);
		query.put("sort", location.sort === "new" ? "new" : null);
	}
	return join(path, query, hash);
}

/** The href with the drawer and everything only it owns removed (`feedback`, `idea`, `compose`). */
export function withoutFeedbackOverlay(href: string): string {
	const { path, query, hash } = split(href);
	for (const key of [FEEDBACK_OVERLAY_PARAM, "idea", "compose"]) query.put(key, null);
	return join(path, query, hash);
}

/**
 * The address of one idea — what a row's link points at, so it opens in a new tab or is copied as a
 * working link. On `/feedback` it keeps the tab and order the reader is on (`currentHref` is that
 * page); in the drawer it is the host page with `feedback=open&idea=…`.
 */
export function feedbackIdeaHref(
	slug: string,
	mode: "page" | "drawer",
	currentHref: string,
): string {
	if (mode === "drawer") {
		return withFeedbackLocation(currentHref, { ...FEEDBACK_HOME, view: "idea", idea: slug }, {
			overlay: true,
		});
	}
	const here = readFeedbackLocation(split(currentHref).query.params());
	return withFeedbackLocation(FEEDBACK_PATH, { ...here, view: "idea", idea: slug }, {
		filters: true,
	});
}

/** The href back to the board from an idea or the form, keeping the tab and order on `/feedback`. */
export function feedbackBoardHref(mode: "page" | "drawer", currentHref: string): string {
	const here = readFeedbackLocation(split(currentHref).query.params());
	return mode === "page"
		? withFeedbackLocation(FEEDBACK_PATH, { ...here, view: "board", idea: null }, { filters: true })
		: withFeedbackLocation(currentHref, { ...here, view: "board", idea: null }, { overlay: true });
}
