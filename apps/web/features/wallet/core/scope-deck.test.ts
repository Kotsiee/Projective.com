import { assertEquals } from "@std/assert";
import type { MoneyView, WalletRef, WalletScope, WalletSwitcher } from "../types/wallet-types.ts";
import {
	deckParam,
	deckPosition,
	leaveOffset,
	neighbourOf,
	scopeDeck,
	scopeHref,
	showsAggregate,
	stepForKey,
	swipeOutcome,
} from "./scope-deck.ts";

const money = (minor: number): MoneyView => ({
	minor,
	currency: "GBP",
	display: `£${(minor / 100).toFixed(2)}`,
	origin: null,
});

const ref = (scope: WalletScope, id: string, name: string): WalletRef => ({
	scope,
	id,
	handle: null,
	name,
	avatar: null,
	role: scope === "personal" || scope === "aggregate" ? null : "owner",
	available: money(100),
});

const PERSONAL = ref("personal", "", "Ada");
const TEAM = ref("team", "t1", "Fern");
const BUSINESS = ref("business", "b1", "Helia");
const ALL = ref("aggregate", "", "All accounts");

function switcher(accounts: WalletRef[], active: WalletRef = accounts[0]): WalletSwitcher {
	const w = deckParam(active);
	return { active, accounts, aggregate: ALL, requested: w, resolved: w };
}

Deno.test("scopeDeck lists the personal wallet first, then the vaults, then the rollup", () => {
	const deck = scopeDeck(switcher([TEAM, PERSONAL, BUSINESS], TEAM));
	assertEquals(deck.map(deckParam), ["personal", "team:t1", "business:b1", "aggregate"]);
});

Deno.test("scopeDeck offers no rollup over a single account unless the rollup is on screen", () => {
	assertEquals(scopeDeck(switcher([PERSONAL])).map(deckParam), ["personal"]);
	assertEquals(showsAggregate(switcher([PERSONAL], ALL)), true);
	assertEquals(scopeDeck(switcher([PERSONAL], ALL)).map(deckParam), ["personal", "aggregate"]);
});

Deno.test("deckPosition wraps at both ends, so both chevrons always lead somewhere", () => {
	const deck = scopeDeck(switcher([PERSONAL, TEAM, BUSINESS]));
	const first = deckPosition(deck, "personal");
	assertEquals([first.index, first.count], [0, 4]);
	assertEquals(first.prev && deckParam(first.prev), "aggregate");
	assertEquals(first.next && deckParam(first.next), "team:t1");
	const last = deckPosition(deck, "aggregate");
	assertEquals(last.next && deckParam(last.next), "personal");
});

Deno.test("deckPosition has no neighbours with a single wallet, and falls back to the first", () => {
	const lone = deckPosition(scopeDeck(switcher([PERSONAL])), "personal");
	assertEquals([lone.prev, lone.next, lone.count], [null, null, 1]);
	const unknown = deckPosition(scopeDeck(switcher([PERSONAL, TEAM])), "team:gone");
	assertEquals(unknown.index, 0);
});

Deno.test("scopeHref keeps the page, the display currency and a non-default window", () => {
	assertEquals(
		scopeHref(TEAM, "analytics", "GBP", "3m"),
		"/wallet/analytics?w=team%3At1&display=GBP&flow=3m",
	);
	assertEquals(scopeHref(PERSONAL, "overview", "GBP", "1m"), "/wallet?w=personal&display=GBP");
	assertEquals(scopeHref(BUSINESS, "invoices", null, "3m"), "/wallet/invoices?w=business%3Ab1");
	const at = deckPosition(scopeDeck(switcher([PERSONAL, TEAM])), "personal");
	assertEquals(neighbourOf(at, "next")?.name, "Fern");
	assertEquals(neighbourOf(at, "prev")?.name, "All accounts");
});

Deno.test("swipeOutcome commits past the share or on a flick, mirrored under RTL", () => {
	const width = 400;
	assertEquals(swipeOutcome({ dx: -120, width, velocity: 0, rtl: false }), "next");
	assertEquals(swipeOutcome({ dx: 120, width, velocity: 0, rtl: false }), "prev");
	assertEquals(swipeOutcome({ dx: -120, width, velocity: 0, rtl: true }), "prev");
	assertEquals(swipeOutcome({ dx: 120, width, velocity: 0, rtl: true }), "next");
	assertEquals(swipeOutcome({ dx: -40, width, velocity: 0, rtl: false }), null, "short and slow settles");
	assertEquals(swipeOutcome({ dx: -40, width, velocity: -0.8, rtl: false }), "next", "a flick commits");
	assertEquals(swipeOutcome({ dx: -10, width, velocity: -2, rtl: false }), null, "a twitch never does");
	assertEquals(
		swipeOutcome({ dx: -40, width, velocity: 0.8, rtl: false }),
		null,
		"a flick back against the drag settles",
	);
	assertEquals(swipeOutcome({ dx: Number.NaN, width, velocity: Number.NaN, rtl: false }), null);
});

Deno.test("leaveOffset sends the slide out on the side its content leaves by", () => {
	assertEquals(leaveOffset("next", 300, false), -300);
	assertEquals(leaveOffset("prev", 300, false), 300);
	assertEquals(leaveOffset("next", 300, true), 300);
	assertEquals(leaveOffset("prev", 300, true), -300);
});

Deno.test("stepForKey mirrors the arrows under RTL and ignores every other key", () => {
	assertEquals(stepForKey("ArrowRight", false), "next");
	assertEquals(stepForKey("ArrowLeft", false), "prev");
	assertEquals(stepForKey("ArrowRight", true), "prev");
	assertEquals(stepForKey("Enter", false), null);
});
