import {
	SCREEN_SHARE_ACTIVE,
	SCREEN_SHARE_AMOUNT_LABEL,
	SCREEN_SHARE_ATTRIBUTE,
	SCREEN_SHARE_HIDDEN_LABEL,
	SCREEN_SHARE_MASK,
} from "@projective/ui/utils/screen-share";
import { LocalKeys, readStored, removeStored, writeStored } from "@web/utils/storage-keys.ts";
import {
	SCREEN_SHARE_COOKIE,
	SCREEN_SHARE_COOKIE_ON,
	screenShareCookie,
} from "@web/utils/screen-share-context.ts";
import {
	displayCurrency,
	displayLocale,
	fxTable,
	reprojectServerMoney,
} from "@web/features/shell/core/currency-state.ts";

/**
 * screen-share-state — the app-side half of screen sharing mode (Decision #297): the carriers
 * (`<html>` attribute, cookie, `localStorage`), and the hydrated layer's sweep of server-rendered
 * `[data-money]` / `[data-obscure]` nodes into an in-memory `WeakMap`. The store lives in
 * `@projective/ui/utils/screen-share`; `ScreenShareBridge` is the one owner that applies a change.
 */

// #region Requests
/** The `document` event every control (and devtools) turns the mode on or off with. */
export const SCREEN_SHARE_EVENT = "pj:screen-share";

/** The detail of a {@link SCREEN_SHARE_EVENT}. `active` omitted means "toggle". */
export interface ScreenShareRequest {
	active?: boolean;
}

/**
 * Ask the bridge to turn screen sharing mode on (`true`), off (`false`) or over (omitted). The
 * bridge applies it synchronously, inside this call.
 */
export function setScreenShareMode(active?: boolean): void {
	if (typeof document === "undefined") return;
	document.dispatchEvent(
		new CustomEvent<ScreenShareRequest>(SCREEN_SHARE_EVENT, { detail: { active } }),
	);
}
// #endregion

// #region Carriers
/** The polite announcements, in the order on → off. */
export const SCREEN_SHARE_ANNOUNCEMENT = {
	on: "Screen sharing mode on",
	off: "Screen sharing mode off",
} as const;

function cookieOn(): boolean {
	const want = `${SCREEN_SHARE_COOKIE}=${SCREEN_SHARE_COOKIE_ON}`;
	return document.cookie.split(";").some((part) => part.trim() === want);
}

/**
 * Whether this device is in screen sharing mode: the attribute (SSR or the restorer), the
 * `localStorage` copy or the cookie. Any one is enough, because each can only remove output.
 */
export function readDeviceScreenShare(): boolean {
	return document.documentElement.getAttribute(SCREEN_SHARE_ATTRIBUTE) === SCREEN_SHARE_ACTIVE ||
		readStored("local", LocalKeys.SCREEN_SHARE) === SCREEN_SHARE_COOKIE_ON ||
		cookieOn();
}

/** Write the attribute. */
export function writeScreenShareAttribute(active: boolean): void {
	const root = document.documentElement;
	if (active) root.setAttribute(SCREEN_SHARE_ATTRIBUTE, SCREEN_SHARE_ACTIVE);
	else root.removeAttribute(SCREEN_SHARE_ATTRIBUTE);
}

/** Write the cookie, then the `localStorage` copy, whose `storage` event flips every other tab. */
export function persistScreenShare(active: boolean): void {
	document.cookie = screenShareCookie(active, location.protocol === "https:");
	if (active) writeStored("local", LocalKeys.SCREEN_SHARE, SCREEN_SHARE_COOKIE_ON);
	else removeStored("local", LocalKeys.SCREEN_SHARE);
}
// #endregion

// #region The sweep
interface SweptNode {
	/** `null` when the tier keeps its children (blur). */
	children: Node[] | null;
	attributes: Array<[string, string]>;
	/** The class list before the sweep, when the sweep changed it. */
	className: string | null;
}

const swept = new WeakMap<Element, SweptNode>();

const OBSCURE_SELECTOR = "[data-obscure]:not([data-obscure-live]):not([data-obscure-masked])";
const MONEY_SELECTOR = "[data-money]:not([data-money-live]):not([data-money-masked])";
const SCRUBBED_ATTRIBUTES = new Set([
	"title",
	"aria-label",
	"aria-description",
	"aria-valuetext",
	"aria-valuenow",
]);
const KEPT_DATA = new Set(["data-money", "data-money-currency", "data-money-size"]);

function isScrubbed(name: string): boolean {
	if (SCRUBBED_ATTRIBUTES.has(name)) return true;
	if (!name.startsWith("data-")) return false;
	return !KEPT_DATA.has(name) && name !== "data-money-hide-origin" &&
		!name.startsWith("data-obscure");
}

function span(className: string, text: string, hidden: boolean): HTMLSpanElement {
	const el = document.createElement("span");
	el.className = className;
	el.textContent = text;
	if (hidden) el.setAttribute("aria-hidden", "true");
	return el;
}

function stash(el: Element, withChildren: boolean, className: string | null = null): void {
	const attributes: Array<[string, string]> = [];
	for (const attr of Array.from(el.attributes)) {
		if (isScrubbed(attr.name)) attributes.push([attr.name, attr.value]);
	}
	for (const [name] of attributes) el.removeAttribute(name);
	swept.set(el, {
		children: withChildren ? Array.from(el.childNodes) : null,
		attributes,
		className,
	});
}

function maskMoney(el: HTMLElement): void {
	const amount = el.querySelector(".ui-money__amount");
	const masked = span("ui-money__amount ui-money__num", "", true);
	for (const part of Array.from(amount?.children ?? [])) {
		if (part.classList.contains("ui-money__major")) {
			masked.append(span("ui-obscure__mask", SCREEN_SHARE_MASK, false));
		} else if (
			part.classList.contains("ui-money__sign") || part.classList.contains("ui-money__symbol")
		) {
			masked.append(part.cloneNode(true));
		}
	}
	if (!masked.querySelector(".ui-obscure__mask")) {
		masked.append(span("ui-obscure__mask", SCREEN_SHARE_MASK, false));
	}
	stash(el, true, el.getAttribute("class"));
	el.classList.add("ui-obscure", "ui-obscure--mask");
	el.replaceChildren(masked, span("ui-visually-hidden", SCREEN_SHARE_AMOUNT_LABEL, false));
	el.setAttribute("data-money-masked", "");
}

function obscure(el: HTMLElement): void {
	const tier = el.getAttribute("data-obscure");
	stash(el, tier !== "blur");
	if (tier === "mask") {
		el.replaceChildren(
			span("ui-obscure__mask", SCREEN_SHARE_MASK, true),
			span("ui-visually-hidden", SCREEN_SHARE_HIDDEN_LABEL, false),
		);
	} else if (tier === "solid") {
		el.replaceChildren(
			span("ui-obscure__placeholder", "", true),
			span("ui-visually-hidden", SCREEN_SHARE_HIDDEN_LABEL, false),
		);
	} else if (tier !== "blur") {
		el.replaceChildren();
	}
	el.setAttribute("data-obscure-masked", "");
}

/**
 * Scrub every server-rendered sensitive node the server did not already mask: its text and its
 * figure-bearing attributes move into the `WeakMap`, and the tier's placeholder takes their place.
 * Island-owned nodes (`data-money-live` / `data-obscure-live`) re-render from the store instead.
 * Obscure nodes go first, so a figure inside one leaves the document intact rather than masked.
 */
export function sweepServerNodes(): void {
	for (const el of document.querySelectorAll<HTMLElement>(OBSCURE_SELECTOR)) obscure(el);
	for (const el of document.querySelectorAll<HTMLElement>(MONEY_SELECTOR)) maskMoney(el);
}

function restore(el: Element, marker: string): boolean {
	const entry = swept.get(el);
	if (!entry) return false;
	if (entry.children) el.replaceChildren(...entry.children);
	for (const [name, value] of entry.attributes) el.setAttribute(name, value);
	if (entry.className !== null) el.setAttribute("class", entry.className);
	el.removeAttribute(marker);
	swept.delete(el);
	return true;
}

/**
 * Put every swept node back from the `WeakMap`, and count the masked nodes that cannot come back:
 * a figure masked from the first byte never reached the client, so it stays masked until the next
 * navigation. Re-projects the restored figures when the currency changed while they were hidden.
 */
export function restoreServerNodes(): number {
	let kept = 0;
	for (const el of document.querySelectorAll("[data-obscure-masked]:not([data-obscure-live])")) {
		if (restore(el, "data-obscure-masked")) continue;
		if (el.getAttribute("data-obscure") === "blur") el.removeAttribute("data-obscure-masked");
		else kept++;
	}
	for (const el of document.querySelectorAll("[data-money-masked]:not([data-money-live])")) {
		if (!restore(el, "data-money-masked")) kept++;
	}
	if (displayCurrency.value !== document.documentElement.dataset.currency) {
		reprojectServerMoney(displayCurrency.value, displayLocale.value, fxTable.value);
	}
	return kept;
}
// #endregion
