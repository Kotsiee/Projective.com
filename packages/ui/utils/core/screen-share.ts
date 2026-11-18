import { computed, type ReadonlySignal, signal, useSignal } from "@preact/signals";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * screen-share — the portable state of screen sharing mode (DESIGN_SYSTEM.md §B.14).
 *
 * Server components read the request's {@link ScreenShareContext} (or the host's ambient resolver);
 * islands read the {@link screenShareActive} signal, seeded from `<html data-screen-share="active">`
 * the moment this module loads, so no island can render a figure before the mode is known. Imports
 * only `@preact/signals` and `preact`, like `currency-store`.
 */

// #region Contract
/** The `<html>` attribute every treatment keys on. */
export const SCREEN_SHARE_ATTRIBUTE = "data-screen-share";
/** Its only value. The mode off writes no attribute at all. */
export const SCREEN_SHARE_ACTIVE = "active";
/** Tier A's fixed glyph run. It never varies with the value's length. */
export const SCREEN_SHARE_MASK = "••••••";
/** The accessible name of a masked amount. */
export const SCREEN_SHARE_AMOUNT_LABEL = "Amount hidden while screen sharing";
/** The accessible name of any other masked or redacted value. */
export const SCREEN_SHARE_HIDDEN_LABEL = "Hidden while screen sharing";
// #endregion

// #region Text
const GLYPH = "[£$€¥₹₩₦₱₪₫₴₺₽฿]";
const CODE = "(?:[A-Z]{3}|kr|zł)";
const AMOUNT = String.raw`\d[\d.,  ']*\d|\d`;
const FIGURE = new RegExp(
	String.raw`(?<lead>(?:${GLYPH}|(?<![A-Za-z])${CODE})[\s ]?)(?:${AMOUNT})` +
		String
			.raw`|(?<![\d.,])(?:${AMOUNT})(?<trail>[\s ]?(?:${GLYPH}|${CODE}(?![A-Za-z])))(?![\s ]?\d)`,
	"g",
);

/**
 * Replace every money figure in free text (a canvas label, a meta line) with its currency symbol
 * and the fixed mask run; dates, counts and words pass through. For text a component paints itself.
 */
export function maskFigures(text: string): string {
	return text.replace(FIGURE, (...args) => {
		const groups = args.at(-1) as { lead?: string; trail?: string };
		return groups.lead !== undefined
			? `${groups.lead}${SCREEN_SHARE_MASK}`
			: `${SCREEN_SHARE_MASK}${groups.trail ?? ""}`;
	});
}
// #endregion

// #region Store
interface MinimalDocument {
	documentElement: { getAttribute(name: string): string | null };
}

function doc(): MinimalDocument | null {
	return (globalThis as { document?: MinimalDocument }).document ?? null;
}

function readAttribute(): boolean {
	return doc()?.documentElement.getAttribute(SCREEN_SHARE_ATTRIBUTE) === SCREEN_SHARE_ACTIVE;
}

const activeSignal = signal<boolean>(readAttribute());

/** Whether screen sharing mode is on in this document. What islands read. */
export const screenShareActive: ReadonlySignal<boolean> = computed(() => activeSignal.value);

/** Set the store. Every reading island re-renders in the same frame; nothing is persisted here. */
export function setScreenShareActive(active: boolean): void {
	if (activeSignal.value !== active) activeSignal.value = active;
}

/** Re-seed the store from the `<html>` attribute. A no-op without a document. */
export function hydrateScreenShareFromDom(): void {
	if (doc()) setScreenShareActive(readAttribute());
}
// #endregion

// #region Request-scoped context (SSR)
/** The per-request answer a server-rendered subtree masks with. */
export interface ScreenShareView {
	active: boolean;
}

/**
 * The per-request screen sharing state for server rendering. Context, never the module signal: one
 * server process renders many viewers at once.
 */
export const ScreenShareContext = createContext<ScreenShareView | null>(null);

let ambientResolver: (() => ScreenShareView | null) | null = null;

/**
 * Install (or clear, with `null`) the host's request-scoped resolver, for server components inside
 * an island subtree, where the root provider's context does not reach. Server-only.
 */
export function setAmbientScreenShareResolver(
	resolver: (() => ScreenShareView | null) | null,
): void {
	ambientResolver = resolver;
}

/** Resolve the mode for one render: context → the host's ambient resolver → the store. */
export function useScreenShareActive(): boolean {
	const ctx = useContext(ScreenShareContext);
	const ambient = ctx ?? ambientResolver?.() ?? null;
	return ambient ? ambient.active : activeSignal.value;
}

const identity = (text: string): string => text;

/**
 * The text filter for strings that carry a formatted amount (a button label, an `aria-label`, a
 * screen-reader line): {@link maskFigures} while the mode is on, the text unchanged otherwise.
 */
export function useMaskFigures(): (text: string) => string {
	return useScreenShareActive() ? maskFigures : identity;
}
// #endregion

// #region Hold to reveal
/** The press-and-hold state and the handlers a Show control spreads onto its button. */
export interface HoldToReveal {
	revealing: boolean;
	handlers: {
		onMouseDown: (event: MouseEvent) => void;
		onPointerDown: (event: PointerEvent) => void;
		onPointerUp: () => void;
		onPointerCancel: () => void;
		onPointerLeave: () => void;
		onContextMenu: (event: Event) => void;
		onKeyDown: (event: KeyboardEvent) => void;
		onKeyUp: (event: KeyboardEvent) => void;
		onBlur: () => void;
		onClick: (event: Event) => void;
	};
}

const isRevealKey = (key: string) => key === " " || key === "Enter";

/**
 * Press-and-hold reveal (Decision #297 ruling (c)): `revealing` is true only while a primary
 * pointer or Space/Enter holds the control. It never toggles, keeps the focus where it was on a
 * pointer press, and a long press opens no context menu.
 */
export function useHoldToReveal(): HoldToReveal {
	const revealing = useSignal(false);
	const set = (on: boolean) => {
		revealing.value = on;
	};
	return {
		revealing: revealing.value,
		handlers: {
			onMouseDown: (event) => event.preventDefault(),
			onPointerDown: (event) => {
				if (event.button === 0) set(true);
			},
			onPointerUp: () => set(false),
			onPointerCancel: () => set(false),
			onPointerLeave: () => set(false),
			onContextMenu: (event) => event.preventDefault(),
			onKeyDown: (event) => {
				if (!isRevealKey(event.key)) return;
				event.preventDefault();
				if (!event.repeat) set(true);
			},
			onKeyUp: (event) => {
				if (isRevealKey(event.key)) set(false);
			},
			onBlur: () => set(false),
			onClick: (event) => event.preventDefault(),
		},
	};
}
// #endregion
