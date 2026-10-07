import { assert, assertEquals, assertFalse } from "@std/assert";
import type { LedgerLine, MoneyView, WalletAction, WalletOverview } from "../types/wallet-types.ts";
import { allocationSlices } from "../types/wallet-types.ts";
import {
	flowBars,
	fundStateHint,
	ledgerFeed,
	mergeLedger,
	methodName,
	resolveHeroActions,
	upcomingItems,
} from "./wallet-home.ts";
import {
	defaultPeriodFor,
	FLOW_PERIODS,
	heldIn,
	isElsewhere,
	ledgerApiParams,
	ledgerApiParamsFrom,
	ledgerFiltersFrom,
	ledgerParamsOf,
	periodRange,
	toActivityRange,
	toFlowPeriod,
	viewOfPath,
	viewShowsRuler,
	walletHref,
	walletPageHref,
	withLedgerFilters,
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
		allocation: [],
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

function line(id: string, group: string): LedgerLine {
	return {
		id,
		direction: "credit",
		reason: "escrow_release",
		title: `Line ${id}`,
		counterparty: null,
		counterpartyHandle: null,
		counterpartyKind: null,
		counterpartyAvatar: null,
		amount: money(100),
		fundState: "available",
		category: "earning",
		kind: "escrow_release",
		refKind: null,
		refId: null,
		href: null,
		subject: null,
		instrument: null,
		settlement: "cleared",
		receiptHref: null,
		at: "2026-09-29T10:00:00.000Z",
		dateLabel: group,
		group,
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

Deno.test("a buyer with no payout account is locked out of withdrawing, and told where to fix it", () => {
	const actions = resolveHeroActions(overview({
		quickActions: offered("top_up", "withdraw"),
		verification: {
			...overview().verification,
			subject: "client",
			kycStatus: "verified",
			payoutReady: false,
			canWithdraw: false,
			prompt: null,
			href: "/settings/verification",
		},
	}));
	const withdraw = actions.pills.find((p) => p.action === "withdraw");
	assert(withdraw?.locked, "the database refuses a payout with no destination, so the action is locked");
	assertEquals(withdraw.reason, "Set up a payout account to move money off the platform.");
	assertEquals(withdraw.fixHref, "/settings/verification");
	assertEquals(withdraw.fixLabel, "Set up payouts", "a buyer has no identity check to finish");
	assertFalse(actions.pills.find((p) => p.action === "top_up")?.locked ?? true);
});

Deno.test("a saved method is named the way people write the network, with its last four once", () => {
	assertEquals(methodName({ label: null, brand: "visa", last4: "4242" }), "Visa ·· 4242");
	assertEquals(methodName({ label: null, brand: "amex", last4: "0005" }), "American Express ·· 0005");
	assertEquals(methodName({ label: "Business card", brand: "visa", last4: "4242" }), "Business card ·· 4242");
	assertEquals(methodName({ label: "Visa 4242", brand: "visa", last4: "4242" }), "Visa 4242");
	assertEquals(methodName({ label: null, brand: "link", last4: null }), "Link");
	assertEquals(methodName({ label: null, brand: null, provider: "stripe", last4: null }), "stripe");
	assertEquals(methodName({ label: null, brand: null, last4: null }), "Payment method");
});

Deno.test("the ledger feed heads each run of the server's own group, preserving order", () => {
	const feed = ledgerFeed([
		line("a", "Today"),
		line("b", "Today"),
		line("c", "Yesterday"),
		line("d", "September 2026"),
		line("e", "September 2026"),
	]);
	assertEquals(
		feed.map((item) => item.type === "group" ? `#${item.label}` : item.line.id),
		["#Today", "a", "b", "#Yesterday", "c", "#September 2026", "d", "e"],
	);
	// Keys stay unique when a group name repeats after a later page lands out of order.
	assertEquals(new Set(feed.map((item) => item.key)).size, feed.length);
	assertEquals(ledgerFeed([]), []);
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
		{ label: "1 Sep", start: "2026-09-01", inMinor: 400, outMinor: 100, netMinor: 300 },
		{ label: "2 Sep", start: "2026-09-02", inMinor: 0, outMinor: 800, netMinor: -800 },
	]);
	assertEquals(bars.map((b) => [b.inRatio, b.outRatio]), [[0.5, 0.125], [0, 1]]);
	assertEquals(
		flowBars([{ label: "1 Sep", start: "2026-09-01", inMinor: 0, outMinor: 0, netMinor: 0 }])[0]
			.inRatio,
		0,
	);
});

Deno.test("period, range and address helpers", () => {
	assertEquals(toFlowPeriod("6m"), "6m");
	assertEquals(toFlowPeriod("all"), "all");
	assertEquals(toFlowPeriod("decade"), "1m");
	assertEquals(toFlowPeriod(null), "1m");
	// A window bookmarked before the ruler keeps its span.
	assertEquals(toFlowPeriod("week"), "7d");
	assertEquals(toFlowPeriod("year"), "1y");
	assertEquals(periodRange("7d"), "7d");
	assertEquals(periodRange("6m"), "180d");
	assertEquals(periodRange("5y"), "5y");
	assertEquals(periodRange("all"), "all");
	assertEquals(toActivityRange("7d"), "7d");
	assertEquals(toActivityRange("180d"), "180d");
	assertEquals(toActivityRange("all"), "all");
	assertEquals(toActivityRange("decade"), "90d");
	assertEquals(toActivityRange(null), "90d");
	// Every ruler period reaches a window the endpoint accepts.
	for (const period of FLOW_PERIODS) {
		assertEquals(toActivityRange(periodRange(period)), periodRange(period));
	}
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

Deno.test("the allocation divides the balance across the states that hold something", () => {
	const slices = allocationSlices({
		available: money(6_000),
		locked: money(3_000),
		pending: money(1_000),
		on_hold: money(0),
	});
	// Ordered by how soon the money can be spent: available, clearing, escrow.
	assertEquals(slices.map((p) => p.state), ["available", "pending", "locked"]);
	assertEquals(slices.map((p) => p.percent), ["60%", "10%", "30%"]);
	assertEquals(slices.map((p) => p.shareBp), [6000, 1000, 3000]);
	assertEquals(slices.map((p) => p.widthBp), [6000, 1000, 3000]);
	assertEquals(slices.some((p) => p.sliver), false);
	assertEquals(
		fundStateHint("locked", overview({ lockedStageCount: 2 })),
		"Held on 2 active stages until the work is approved",
	);
});

Deno.test("allocation percents total 100, drawn widths total 10000, and a sliver is floored, not lost", () => {
	const thirds = allocationSlices({
		available: money(1),
		locked: money(1),
		pending: money(1),
		on_hold: money(0),
	});
	assertEquals(thirds.map((p) => p.percent), ["34%", "33%", "33%"]);
	assertEquals(thirds.reduce((a, p) => a + p.widthBp, 0), 10000);

	const sliver = allocationSlices({
		available: money(99_950),
		pending: money(0),
		locked: money(0),
		on_hold: money(50),
	});
	assertEquals(sliver.map((p) => [p.state, p.percent, p.sliver]), [
		["available", "100%", false],
		["on_hold", "<1%", true],
	]);
	// The true share is kept; only the drawn width is floored, taken from the largest slice.
	assertEquals(sliver[1].shareBp, 5);
	assertEquals(sliver[1].widthBp, 150);
	assertEquals(sliver.reduce((a, p) => a + p.widthBp, 0), 10000);
	assertEquals(
		fundStateHint("on_hold", overview({ heldCaseCount: 1 })),
		"Reserved while 1 case is reviewed",
	);
});

Deno.test("an empty wallet has no slices", () => {
	assertEquals(
		allocationSlices({
			available: money(0),
			pending: money(0),
			locked: money(0),
			on_hold: money(0),
		}),
		[],
	);
});

Deno.test("the ledger's filters live in its address, defaults omitted, and map to the API and back", () => {
	const sp = new URLSearchParams(
		"w=team%3At1&q=helia&dir=out&kind=platform_fee,bogus,escrow_release&flow=3m",
	);
	const filters = ledgerFiltersFrom(sp);
	assertEquals(filters, {
		q: "helia",
		dir: "out",
		kinds: ["escrow_release", "platform_fee"],
		period: "3m",
	});
	assertEquals(ledgerFiltersFrom(new URLSearchParams("")).period, "all");
	const written = withLedgerFilters(new URLSearchParams("w=team%3At1&display=EUR"), filters);
	assertEquals(written.get("w"), "team:t1");
	assertEquals(written.get("display"), "EUR");
	assertEquals(written.get("kind"), "escrow_release,platform_fee");
	const cleared = withLedgerFilters(written, { q: " ", dir: "all", kinds: [], period: "all" });
	assertEquals([...cleared.keys()].sort(), ["display", "w"]);

	const params = ledgerParamsOf(filters);
	assertEquals(params, {
		search: "helia",
		direction: "debit",
		kinds: ["escrow_release", "platform_fee"],
		range: "90d",
	});
	const round = ledgerApiParamsFrom(
		new URLSearchParams({ ...ledgerApiParams({ ...params, cursor: "k:abc", limit: 40 }) }),
	);
	assertEquals(round.search, "helia");
	assertEquals(round.direction, "debit");
	assertEquals(round.kinds, ["escrow_release", "platform_fee"]);
	assertEquals(round.range, "90d");
	assertEquals(round.cursor, "k:abc");
	assertEquals(round.limit, 40);
	assertEquals(
		ledgerApiParamsFrom(new URLSearchParams("range=decade&direction=sideways")).range,
		undefined,
	);
});

Deno.test("wallet pages keep the wallet and currency, and carry a window only where one is drawn", () => {
	assertEquals(walletPageHref("overview", "personal", "GBP"), "/wallet?display=GBP");
	assertEquals(
		walletPageHref("transactions", "team:t1", "EUR", "1y"),
		"/wallet/transactions?w=team%3At1&display=EUR&flow=1y",
	);
	// Each page leaves off its OWN default window: the ledger lists everything, the charts a month.
	assertEquals(walletPageHref("transactions", "personal", null, "all"), "/wallet/transactions");
	assertEquals(
		walletPageHref("transactions", "personal", null, "1m"),
		"/wallet/transactions?flow=1m",
	);
	assertEquals(defaultPeriodFor("transactions"), "all");
	assertEquals(defaultPeriodFor("analytics"), "1m");
	assertEquals(
		walletPageHref("analytics", "personal", null, "1y"),
		"/wallet/analytics?flow=1y",
	);
	// The default window is the absence of `?flow=`, never a redundant copy of it.
	assertEquals(walletPageHref("analytics", "personal", null, "1m"), "/wallet/analytics");
	assert(viewShowsRuler("overview"));
	assertFalse(viewShowsRuler("invoices"));
});

Deno.test("a pathname names a wallet page, or none", () => {
	assertEquals(viewOfPath("/wallet"), "overview");
	assertEquals(viewOfPath("/wallet/"), "overview");
	assertEquals(viewOfPath("/wallet/analytics"), "analytics");
	assertEquals(viewOfPath("/wallet/payouts"), null);
});
