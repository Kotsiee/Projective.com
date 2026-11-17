import type { WalletRef, WalletSwitcher } from "../types/wallet-types.ts";
import { type FlowPeriod, walletPageHref, walletParam, type WalletView } from "./wallet-model.ts";

/** Which way the hero's scope carousel moves: to the wallet before the one shown, or after it. */
export type ScopeStep = "prev" | "next";

/** Where the wallet on screen sits in the carousel, and the wallets either side of it. */
export interface DeckPosition {
	/** The shown wallet's place in the deck, from 0; 0 when the deck does not hold it. */
	index: number;
	count: number;
	/** The wallet a step back lands on (the last one from the first); `null` with fewer than two. */
	prev: WalletRef | null;
	/** The wallet a step forward lands on (the first one from the last); `null` with fewer than two. */
	next: WalletRef | null;
}

/** Whether the read-only "All accounts" rollup is worth offering: with one account it only repeats it. */
export function showsAggregate(switcher: WalletSwitcher): boolean {
	return switcher.accounts.length > 1 || switcher.active.scope === "aggregate";
}

/**
 * Every wallet the hero's carousel and its dropdown step through, in one order: the personal wallet
 * first, then each vault as the server listed it, then the read-only rollup where it is offered. The
 * carousel, its dots and the dropdown read this one list, so a swipe and the menu never disagree about
 * what comes next.
 */
export function scopeDeck(switcher: WalletSwitcher): WalletRef[] {
	const personal = switcher.accounts.filter((ref) => ref.scope === "personal");
	const vaults = switcher.accounts.filter((ref) => ref.scope !== "personal");
	return showsAggregate(switcher)
		? [...personal, ...vaults, switcher.aggregate]
		: [...personal, ...vaults];
}

/** The `?w=` param of a deck entry. */
export function deckParam(ref: WalletRef): string {
	return walletParam(ref.scope, ref.id);
}

/**
 * The shown wallet's place in the deck and its neighbours. The carousel wraps — a step back from the
 * first wallet lands on the last — so both chevrons always lead somewhere while there is more than one.
 */
export function deckPosition(deck: readonly WalletRef[], activeParam: string): DeckPosition {
	const count = deck.length;
	const found = deck.findIndex((ref) => deckParam(ref) === activeParam);
	const index = Math.max(0, found);
	if (count < 2) return { index, count, prev: null, next: null };
	return {
		index,
		count,
		prev: deck[(index - 1 + count) % count],
		next: deck[(index + 1) % count],
	};
}

/** The wallet a step lands on, or `null` while there is nowhere to step to. */
export function neighbourOf(at: DeckPosition, step: ScopeStep): WalletRef | null {
	return step === "prev" ? at.prev : at.next;
}

/**
 * The address of the page on screen for another wallet: the same page, the same display currency and
 * the same window (`?flow=`, dropped where it is the page's default). A currency narrowing
 * (`?currency=`) belongs to the wallet it narrowed and is not carried.
 */
export function scopeHref(
	ref: WalletRef,
	view: WalletView,
	display: string | null,
	flow: FlowPeriod | null,
): string {
	return walletPageHref(view, deckParam(ref), display, flow);
}

/** How far a drag must travel, as a share of the slide's width, before release commits a step. */
export const SWIPE_COMMIT_SHARE = 0.22;

/** A drag shorter than the commit share still commits when released at least this fast (px per ms). */
export const SWIPE_FLICK_SPEED = 0.45;

/** The shortest travel a flick needs, so a twitch at release is never read as a step. */
export const SWIPE_FLICK_MIN_PX = 24;

/** How far a pointer must travel along the inline axis before a press becomes a drag. */
export const SWIPE_SLOP_PX = 8;

/**
 * What a released drag does. A drag toward the reading direction's start brings in the NEXT wallet
 * (the content moves the way the finger does, as a page turns), so the sign flips under a right-to-left
 * writing direction. It commits past {@link SWIPE_COMMIT_SHARE} of the width, or on a flick; anything
 * less settles back.
 */
export function swipeOutcome(
	{ dx, width, velocity, rtl }: { dx: number; width: number; velocity: number; rtl: boolean },
): ScopeStep | null {
	const travel = Number.isFinite(dx) ? dx : 0;
	const speed = Number.isFinite(velocity) ? velocity : 0;
	const far = width > 0 && Math.abs(travel) >= width * SWIPE_COMMIT_SHARE;
	const flick = Math.abs(travel) >= SWIPE_FLICK_MIN_PX && Math.abs(speed) >= SWIPE_FLICK_SPEED &&
		Math.sign(speed) === Math.sign(travel);
	if (!far && !flick) return null;
	const towardStart = rtl ? travel > 0 : travel < 0;
	return towardStart ? "next" : "prev";
}

/**
 * Where the slide rests while it leaves for a step: one full width out, on the side the step's
 * content leaves by — the start side for the next wallet, the end side for the previous one.
 */
export function leaveOffset(step: ScopeStep, width: number, rtl: boolean): number {
	const towardStart = step === "next";
	const sign = towardStart !== rtl ? -1 : 1;
	return sign * Math.max(0, width);
}

/** The arrow key that steps the carousel, mirrored under a right-to-left writing direction. */
export function stepForKey(key: string, rtl: boolean): ScopeStep | null {
	if (key === "ArrowRight") return rtl ? "prev" : "next";
	if (key === "ArrowLeft") return rtl ? "next" : "prev";
	return null;
}
