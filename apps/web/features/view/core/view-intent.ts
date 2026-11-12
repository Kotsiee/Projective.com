import type { ServiceBookingOffer } from "@projective/types/services";
import { withRedirect } from "@features/auth/core/redirect.ts";
import type { EntityArchetype } from "./entity-archetype.ts";

/**
 * view-intent — the listing page's `?intent=` contract (Decision #422), in one pure module the Explore
 * card menu, the two `/view` routes, the page controller and their tests share.
 *
 * - `?intent=book` opens the session slot picker or a cohort's seat panel, `?intent=contact` the
 *   Contact menu and `?intent=apply` a project's apply dialog — each the panel the page's own control
 *   opens (Reserve seat opens its panel since Decision #424).
 * - Only panel-opening controls qualify. Buy now, Add to projects and Join the waitlist write the
 *   moment they are pressed, and a URL can be pasted, prefetched or reopened, so no address may run
 *   them.
 * - A guest is sent to sign-in first, returning to the same URL; the page strips the parameter on
 *   arrival, so a reload or Back never reopens the panel.
 *
 * Every write keeps the other parameters byte for byte, in order, and the hash.
 */

// #region Contract
/** The parameter that asks a listing page to open one of its own conversion panels. */
export const VIEW_INTENT_PARAM = "intent";

/** Every intent a listing page honours. */
export const VIEW_INTENTS = ["book", "contact", "apply"] as const;

/** One intent. */
export type ViewIntent = typeof VIEW_INTENTS[number];

/** What the page knows when it decides whether to honour an intent. */
export interface IntentFacts {
	archetype: EntityArchetype;
	/** The resolved offer's action rig, or `null` for a project or an offer that did not resolve. */
	offer: Pick<ServiceBookingOffer, "cta"> | null;
	authed: boolean;
	/** The lane explains instead of transacting (a restricted viewer, Decision #192). */
	blocked: boolean;
	/** A rendering that acts on nothing: the owner's preview or buyer simulation. */
	inert: boolean;
}
// #endregion

// #region Address
interface HrefParts {
	path: string;
	query: string;
	hash: string;
}

function splitHref(href: string): HrefParts {
	const hashAt = href.indexOf("#");
	const hash = hashAt >= 0 ? href.slice(hashAt) : "";
	const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const queryAt = rest.indexOf("?");
	return queryAt >= 0
		? { path: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash }
		: { path: rest, query: "", hash };
}

function keyOf(segment: string): string {
	const raw = segment.split("=", 1)[0].replace(/\+/g, " ");
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function otherSegments(query: string): string[] {
	return query.split("&").filter((s) => s.length > 0 && keyOf(s) !== VIEW_INTENT_PARAM);
}

function isViewIntent(value: string | null): value is ViewIntent {
	return VIEW_INTENTS.some((intent) => intent === value);
}

/** The intent a query asks for, or `null` for none or an unknown value. */
export function readViewIntent(search: string | URLSearchParams): ViewIntent | null {
	const value = (typeof search === "string" ? new URLSearchParams(search) : search)
		.get(VIEW_INTENT_PARAM);
	return isViewIntent(value) ? value : null;
}

/** `href` asking for `intent`, replacing any intent it already carried. */
export function withViewIntent(href: string, intent: ViewIntent): string {
	const { path, query, hash } = splitHref(href);
	return `${path}?${[...otherSegments(query), `${VIEW_INTENT_PARAM}=${intent}`].join("&")}${hash}`;
}

/** `href` with every intent removed — the address the page leaves in the bar once it has acted. */
export function withoutViewIntent(href: string): string {
	const { path, query, hash } = splitHref(href);
	const rest = otherSegments(query);
	return `${path}${rest.length > 0 ? `?${rest.join("&")}` : ""}${hash}`;
}

/**
 * Where a guest's intent sends them — sign-in, returning to this exact URL so the panel opens once
 * they are back — or `null` when nothing redirects (no intent, or a signed-in viewer).
 */
export function guestIntentRedirect(url: URL, authed: boolean): string | null {
	if (authed || !readViewIntent(url.searchParams)) return null;
	return withRedirect("/login", url.pathname + url.search);
}
// #endregion

// #region Honour
/**
 * The intent the page acts on, or `null`. An intent is honoured only where the page renders that
 * control enabled, so an address can open nothing the reader could not have pressed.
 */
export function honouredIntent(intent: ViewIntent | null, facts: IntentFacts): ViewIntent | null {
	if (!intent || !facts.authed || facts.blocked || facts.inert) return null;
	switch (intent) {
		case "book": {
			const primary = facts.offer?.cta.primary;
			const opensPanel = primary?.kind === "open_scheduler" || primary?.kind === "reserve_seat";
			return opensPanel && !primary.disabled ? intent : null;
		}
		case "contact":
			return facts.offer ? intent : null;
		case "apply":
			return facts.archetype === "project" ? intent : null;
	}
}
// #endregion
