import { assertEquals } from "@std/assert";
import type { FundingStatus } from "@projective/types/finance";
import {
	fundingAction,
	fundingRollup,
	fundingSentence,
	fundingTagState,
	previewFunding,
} from "./funding-ui.ts";

/*
 * The funding line tells a client to pay and a freelancer whether to start. The copy and the one
 * control are the contract, so each state's sentence and action is pinned here.
 */

function f(over: Partial<FundingStatus> = {}): FundingStatus {
	return {
		state: "needs_funding",
		amountMinor: 45000,
		currency: "USD",
		amountLabel: "$450",
		canStart: false,
		nextAction: "fund",
		reason: null,
		...over,
	};
}

const line = (funding: FundingStatus, side: "client" | "provider" = "client", extra = {}) =>
	fundingSentence({ funding, side, freelancer: "Ana", dateLabel: null, ...extra });

Deno.test("client copy, one sentence per state", () => {
	assertEquals(
		line(f({ state: "draft", nextAction: "describe" })),
		"Add a description to make this payable.",
	);
	assertEquals(line(f()), "Fund $450 so Ana can start.");
	assertEquals(
		line(f({ state: "draft", nextAction: "fund" }), "client", { freelancer: null }),
		"Fund $450 so work can start.",
	);
	assertEquals(
		line(f({ state: "processing", nextAction: "await_payment" })),
		"Payment processing…",
	);
	assertEquals(
		line(f({ state: "funded", nextAction: "start_work" })),
		"$450 held in escrow. Ana can start.",
	);
	assertEquals(
		line(f({ state: "in_progress", nextAction: "submit" }), "client", { dateLabel: "Oct 3" }),
		"Work started Oct 3. $450 held until you approve.",
	);
	assertEquals(
		line(f({ state: "in_review", nextAction: "review" })),
		"Review the delivery to release $450.",
	);
	assertEquals(
		line(f({ state: "released", nextAction: "none" }), "client", { dateLabel: "Oct 9" }),
		"Paid $450 on Oct 9.",
	);
	assertEquals(
		line(f({ state: "failed", nextAction: "retry_payment", reason: "Spending limit reached." })),
		"Payment didn't lock: Spending limit reached. The money is in your wallet.",
	);
});

Deno.test("a ticket paid ahead of its claim asks the client for nothing", () => {
	const ahead = f({
		state: "draft",
		nextAction: "none",
		reason: "Paid for — the escrow is held when a freelancer claims it.",
	});
	assertEquals(line(ahead), "Paid for — the escrow is held when a freelancer claims it.");
	assertEquals(fundingAction(ahead, "client"), null);
	assertEquals(fundingRollup([{ id: "a", funding: ahead }]).count, 0);
});

Deno.test("freelancer copy: wait until funded, then start", () => {
	assertEquals(line(f(), "provider"), "Waiting for the client to fund this. Don't start yet.");
	assertEquals(
		line(f({ state: "processing" }), "provider"),
		"Waiting for the client to fund this. Don't start yet.",
	);
	assertEquals(line(f({ state: "funded", canStart: true }), "provider"), "Funded. You can start.");
});

Deno.test("one control per state, and a blocked Start explains itself", () => {
	assertEquals(fundingAction(f(), "client"), "fund");
	assertEquals(fundingAction(f({ state: "in_review", nextAction: "review" }), "client"), "review");
	assertEquals(
		fundingAction(f({ state: "failed", nextAction: "retry_payment" }), "client"),
		"retry",
	);
	assertEquals(fundingAction(f({ state: "funded", nextAction: "start_work" }), "client"), null);
	assertEquals(fundingAction(f({ state: "funded", canStart: true }), "provider"), "start");
	assertEquals(fundingAction(f(), "provider"), "start-blocked");
	assertEquals(fundingAction(f({ state: "in_review" }), "provider"), null);
});

Deno.test("a priced ticket nobody has bought is tagged Needs funding; Draft keeps meaning not payable", () => {
	assertEquals(fundingTagState(f({ state: "draft", nextAction: "fund" })), "needs_funding");
	assertEquals(fundingTagState(f({ state: "draft", nextAction: "describe" })), "draft");
	assertEquals(fundingTagState(f({ state: "funded", nextAction: "start_work" })), "funded");
});

Deno.test("the dev preview forces a state but keeps the real amount", () => {
	const forced = previewFunding(f(), "funded");
	assertEquals([forced.state, forced.canStart, forced.amountLabel], ["funded", true, "$450"]);
	assertEquals(previewFunding(f(), "auto"), f());
});

Deno.test("the roll-up counts the tickets that ask to be funded", () => {
	const r = fundingRollup([
		{ id: "a", funding: f() },
		{ id: "b", funding: f({ state: "funded", nextAction: "start_work" }) },
		{ id: "c", funding: f({ state: "draft", nextAction: "fund", amountMinor: 5000 }) },
		{ id: "d", funding: f({ state: "draft", nextAction: "describe" }) },
		{ id: "e", funding: null },
	]);
	assertEquals(r, { count: 2, totalMinor: 50000, currency: "USD", ids: ["a", "c"] });
});

Deno.test("business billing variants: auto-funded from wallet, and the invoice date on a release", () => {
	assertEquals(
		line(f({ state: "funded", nextAction: "start_work", autoFunded: true })),
		"Auto-funded from wallet: $450 held in escrow. Ana can start.",
	);
	assertEquals(
		line(f({ state: "released", nextAction: "none", invoiceOn: "Nov 15" }), "client", {
			dateLabel: "Oct 2",
		}),
		"Paid $450 on Oct 2. Will be invoiced on Nov 15.",
	);
	// The provider's line is about starting, not about how the client paid.
	assertEquals(
		line(f({ state: "funded", nextAction: "start_work", autoFunded: true }), "provider"),
		"Funded. You can start.",
	);
});

Deno.test("a session seat speaks its own lifecycle: reserved → confirmed → released after the session", () => {
	const seat = (funding: FundingStatus, side: "client" | "provider" = "client") =>
		fundingSentence({
			funding,
			side,
			freelancer: null,
			dateLabel: null,
			kind: "session",
			sessionTerms: { joinLeadMinutes: 10, payoutHours: 24 },
		});
	assertEquals(seat(f()), "Seat reserved, pay to confirm.");
	assertEquals(seat(f({ state: "funded", nextAction: "none" })), "Confirmed, join link opens 10 min before.");
	assertEquals(
		seat(f({ state: "in_review", nextAction: "none" })),
		"Session ended. $450 releases 24h after the session unless you report a no-show.",
	);
	assertEquals(seat(f({ state: "released", nextAction: "none" })), "Released 24h after the session.");
	assertEquals(seat(f({ state: "funded", nextAction: "none" }), "provider"), "Confirmed. $450 held until 24h after the session.");
	assertEquals(seat(f(), "provider"), "Seat reserved. Waiting for the attendee to pay.");
	// The terms are the platform's figures, not hard-coded copy.
	assertEquals(
		fundingSentence({
			funding: f({ state: "funded", nextAction: "none" }),
			side: "client",
			freelancer: null,
			dateLabel: null,
			kind: "session",
			sessionTerms: { joinLeadMinutes: 5, payoutHours: 48 },
		}),
		"Confirmed, join link opens 5 min before.",
	);
});
