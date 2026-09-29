import { assert, assertEquals, assertFalse } from "@std/assert";
import type { LedgerLine, MoneyView, WalletAction, WalletOverview } from "../types/wallet-types.ts";
import {
	bandLedger,
	flowBars,
	mergeLedger,
	resolveHeroActions,
	upcomingItems,
} from "./wallet-home.ts";
import {
	heldIn,
	isElsewhere,
	periodRange,
	toActivityRange,
	toFlowPeriod,
	walletHref,
} from "./wallet-model.ts";

const money = (minor: number, currency = "GBP"): MoneyView => ({
	minor,
	currency,
	display: `£${(minor / 100).toFixed(2)}`,
	origin: null,
});

function overview(patch: Partial<WalletOverview> = {}): WalletOverview {
	return {
		ref: {
			scope: "personal",
			id: "",
			handle: null,
			name: "Ada",
			avatar: null,
			role: null,
			available: money(0),
		},
		variant: "personal",
		balances: {
			currency: "GBP",
			availableCents: 0,
			lockedCents: 0,
			pendingCents: 0,
			onHoldCents: 0,
			lifetimeCents: 0,
		},
		available: money(10_000),
		locked: money(0),
		pending: money(0),
		onHold: money(0),
		lifetime: money(0),
		capital: money(10_000),
		lockedStageCount: 0,
		heldCaseCount: 0,
		incoming: [],
		flow: [],
		flowRange: "90d",
		recent: [],
		quickActions: [],
		unavailable: [],
		capabilities: ["view"],
		verification: {
			subject: "freelancer",
			kycStatus: "verified",
			tier: 2,
			payoutReady: true,
			canWithdraw: true,
			canEarn: true,
			prompt: null,
			href: null,
		},
		standing: null,
		personal: null,
		team: null,
		business: null,
		...patch,
	} as WalletOverview;
}

function line(id: string, dateLabel: string): LedgerLine {
	return {
		id,
		direction: "credit",
		reason: "escrow_release",
		title: `Line ${id}`,
		counterparty: null,
		counterpartyHandle: null,
		amount: money(100),
		fundState: "available",
		category: "earning",
		refKind: null,
		refId: null,
		href: null,
		at: "2026-09-29T10:00:00.000Z",
		dateLabel,
	};
}

const offered = (...actions: WalletAction[]) => actions;

Deno.test("pills follow Top up · Transfer · Withdraw · Split and the rest overflow", () => {
	const actions = resolveHeroActions(overview({
		quickActions: offered(
			"withdraw",
			"top_up",
			"new_recurring",
			"transfer",
			"set_payout",
			"distribute",
		),
	}));
	assertEquals(actions.pills.map((a) => a.action), [
		"top_up",
		"transfer",
		"withdraw",
		"distribute",
	]);
	assertEquals(actions.more.map((a) => a.action), ["new_recurring", "set_payout"]);
});

Deno.test("a single overflow action becomes its own pill rather than a one-item menu", () => {
	const actions = resolveHeroActions(overview({ quickActions: offered("request_spend") }));
	assertEquals(actions.pills.map((a) => a.action), ["request_spend"]);
	assertEquals(actions.more, []);
});

Deno.test("an action the server did not offer is never drawn", () => {
	const actions = resolveHeroActions(overview({ quickActions: offered("top_up") }));
	assertFalse(actions.pills.some((a) => a.action === "withdraw"));
});

Deno.test("an unavailable action is locked with the server's reason, which outranks verification", () => {
	const actions = resolveHeroActions(overview({
		quickActions: offered("withdraw"),
		unavailable: [{ action: "withdraw", reason: "No payout processor here." }],
		verification: { ...overview().verification, canWithdraw: false, prompt: "Verify first" },
	}));
	assertEquals(actions.pills[0].locked, true);
	assertEquals(actions.pills[0].reason, "No payout processor here.");
});

Deno.test("money leaving the platform waits on a payout-ready identity", () => {
	const actions = resolveHeroActions(overview({
		quickActions: offered("transfer", "withdraw"),
		verification: {
			...overview().verification,
			canWithdraw: false,
			prompt: "Add a payout method to get paid",
			href: "/wallet/payouts",
		},
	}));
	const [transfer, withdraw] = actions.pills;
	assertFalse(transfer.locked);
	assert(withdraw.locked);
	assertEquals(withdraw.reason, "Add a payout method to get paid");
	assertEquals(withdraw.fixHref, null, "a fix href back into the wallet is not a way out");
});

Deno.test("the ledger bands by the server's own date label, preserving order", () => {
	const bands = bandLedger([
		line("a", "Today"),
		line("b", "3 days ago"),
		line("c", "Today"),
		line("d", "Yesterday"),
	]);
	assertEquals(bands.map((b) => b.key), ["today", "yesterday", "earlier"]);
	assertEquals(bands[0].lines.map((l) => l.id), ["a", "c"]);
	assertEquals(bandLedger([]), []);
});

Deno.test("merging a page drops lines already shown", () => {
	const merged = mergeLedger([line("a", "Today"), line("b", "Today")], [
		line("b", "Today"),
		line("c", "Today"),
	]);
	assertEquals(merged.map((l) => l.id), ["a", "b", "c"]);
});

Deno.test("upcoming leads with what needs the viewer and attaches only offered actions", () => {
	const items = upcomingItems({
		overview: overview({
			quickActions: offered("set_payout"),
			incoming: [{
				id: "pending-1",
				kind: "pending_release",
				label: "Release clearing",
				amount: money(500),
				state: "pending",
				clearingLabel: "Clears in 3 days",
				clearingAt: null,
				clearingFraction: 0.5,
				href: "/wallet/transactions",
			}],
			verification: {
				...overview().verification,
				kycStatus: "unverified",
				canWithdraw: false,
				prompt: "Verify your identity to start earning",
			},
		}),
		schedule: {
			mode: "scheduled_monthly",
			destinationLabel: "Monzo ·· 4410",
			threshold: null,
			instant: false,
			nextRunLabel: "Next run Wed 1 Oct",
		},
		approvals: [{
			id: "ap1",
			requesterName: "Hannah Cole",
			requesterHandle: "hannahcole",
			amount: money(4_000),
			reason: "Fonts",
			status: "pending",
			at: "2026-09-29T10:00:00.000Z",
			dateLabel: "Today",
		}],
		canDecide: false,
	});
	assertEquals(items.map((i) => i.kind), ["verify", "approval", "release", "payout"]);
	assertEquals(items[0].action, null, "no verification action exists to offer");
	assertEquals(items[1].action, null, "a viewer who cannot decide gets no Review");
	assertEquals(items[2].progress, 0.5);
	assertEquals(items[2].href, null, "a link back into the wallet is dropped");
	assertEquals(items[3].action?.kind, "action");
});

Deno.test("a payout schedule row is omitted while payouts are manual", () => {
	const items = upcomingItems({
		overview: overview(),
		schedule: {
			mode: "manual",
			destinationLabel: null,
			threshold: null,
			instant: false,
			nextRunLabel: null,
		},
	});
	assertEquals(items, []);
});

Deno.test("flow bars share one peak across money in and out, and an empty window is flat", () => {
	const bars = flowBars([
		{ label: "1 Sep", inMinor: 400, outMinor: 100 },
		{ label: "2 Sep", inMinor: 0, outMinor: 800 },
	]);
	assertEquals(bars.map((b) => [b.inRatio, b.outRatio]), [[0.5, 0.125], [0, 1]]);
	assertEquals(flowBars([{ label: "1 Sep", inMinor: 0, outMinor: 0 }])[0].inRatio, 0);
});

Deno.test("period, range and address helpers", () => {
	assertEquals(toFlowPeriod("year"), "year");
	assertEquals(toFlowPeriod("decade"), "month");
	assertEquals(periodRange("week"), "7d");
	assertEquals(toActivityRange("7d"), "7d");
	assertEquals(toActivityRange(null), "90d");
	assertEquals(walletHref("personal", null), "/wallet");
	assertEquals(
		walletHref("team:abc", "EUR", "upcoming"),
		"/wallet?w=team%3Aabc&display=EUR#upcoming",
	);
	assert(isElsewhere("/projects/prj-1"));
	assertFalse(isElsewhere("/wallet/transactions"));
	assertFalse(isElsewhere("/wallet?w=team:1"));
	assertFalse(isElsewhere("https://example.com"));
	assertEquals(
		heldIn({
			minor: 870,
			currency: "GBP",
			display: "£8.70",
			origin: { minor: 1000, currency: "eur", display: "€10.00", fxRate: 0.87 },
		}),
		{ minor: 1000, currency: "EUR" },
	);
});
