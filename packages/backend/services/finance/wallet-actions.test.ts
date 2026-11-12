import { assert, assertEquals, assertFalse } from "@std/assert";
import type { PayoutScheduleInput, WalletQuery } from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { LOCK_REASON } from "./live-wallet.ts";
import {
	actionTarget,
	addMethod,
	distribute,
	enrolSmoother,
	payoutScheduleArgs,
	payoutScheduleRefusal,
	recurringChange,
	savePotArgs,
	setPayout,
} from "./wallet-actions.ts";
import type { WalletAccount, WalletContext } from "./wallet-scope.ts";

const FOREIGN = "business:7c2d9e8f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

/** The viewer's own wallet: what a foreign `w` used to fall back to, with money in it to move. */
const PERSONAL: WalletAccount = {
	scope: "personal",
	id: "",
	key: "personal",
	owner: {} as WalletAccount["owner"],
	rows: [{
		id: "w-own",
		owner_type: "user",
		owner_id: "u-1",
		currency: "USD",
		balance_cents: 50_000,
		approval_threshold_cents: null,
	}],
	role: null,
	capabilities: [
		"view",
		"add_funds",
		"spend",
		"distribute",
		"withdraw",
		"manage_members",
		"manage_billing",
	],
};

function contextOf(
	requested: string,
	resolved: string,
	target: WalletContext["target"],
): WalletContext {
	return { requested, resolved, target, accounts: [PERSONAL] } as unknown as WalletContext;
}

Deno.test("an action naming a wallet the viewer cannot open is refused before any door (Audit R5)", () => {
	// The read fell back to the personal wallet; the action must not run there.
	const out = actionTarget(contextOf(FOREIGN, "personal", PERSONAL));
	assert(!("account" in out), "no account comes back, so no door is called and nothing moves");
	assertEquals([out.ok, out.status, out.message], [
		false,
		403,
		"That wallet isn't available to you.",
	]);
});

Deno.test("an action on the wallet it names runs there; the rollup stays read-only", () => {
	const own = actionTarget(contextOf("personal", "personal", PERSONAL));
	assert("account" in own);
	assertEquals(own.account, PERSONAL);
	const all = actionTarget(contextOf("aggregate", "aggregate", "aggregate"));
	assert(!("account" in all));
	assertEquals(all.status, 422);
});

// #region The wallet an action names (no vault without an id)
/** Nothing past the refusal is reached: a door would need a database this test does not have. */
const QUERY: WalletQuery = { wallet: null, display: null };
const ACTOR = {
	userId: "u-1",
	accessToken: "token",
	contextId: "",
	contextType: "personal",
} as ReadActor;

Deno.test("a vault scope with no context id is refused, never read as the personal wallet", async () => {
	const split = await distribute(
		{
			scope: "team",
			contextId: "",
			amountMinor: 1_000,
			currency: "USD",
			idempotencyKey: "attempt-1",
		},
		QUERY,
		ACTOR,
	);
	assertEquals([split.ok, split.status, split.message], [false, 422, "Choose a wallet."]);
	const card = await addMethod(
		{ scope: "business", contextId: "", methodRole: "funding" },
		QUERY,
		ACTOR,
	);
	assertEquals([card.ok, card.status], [false, 422]);
});
// #endregion

// #region Automation locked until its engine runs (Decision #337, ruling M6)
const SCHEDULE: PayoutScheduleInput = {
	scope: "personal",
	contextId: "",
	mode: "manual",
	thresholdMinor: null,
	destinationId: null,
	instant: false,
};

Deno.test("every payout mode reaches the wallet: no mode is locked now that schedules run", async () => {
	assertFalse("schedule_not_running" in LOCK_REASON, "the schedule lock is gone (DB4)");
	for (const mode of ["scheduled_weekly", "scheduled_monthly", "threshold"] as const) {
		const out = await setPayout(
			{ ...SCHEDULE, scope: "team", mode, thresholdMinor: 50_000 },
			QUERY,
			ACTOR,
		);
		// The vault scope with no id is refused before any read, which proves no lock answered first.
		assertEquals([out.ok, out.status, out.message], [false, 422, "Choose a wallet."], mode);
	}
});

Deno.test("the save door's refusals: Instant is planned, authority and a field are worded", () => {
	const instant = payoutScheduleRefusal({
		code: "0A000",
		message: "instant_payout_planned: Instant payouts are planned and not available yet",
	});
	assertEquals([instant.status, instant.details], [409, { reason: "instant_payout_planned" }]);
	const spender = payoutScheduleRefusal({
		code: "42501",
		message: "auth: only a member who may withdraw can change payouts",
	});
	assertEquals([spender.status, spender.message], [
		403,
		"Only a member who may withdraw can change payouts.",
	]);
	const threshold = payoutScheduleRefusal({
		code: "22023",
		message: "thresholdMinor: the smallest payout is 10.00 USD",
	});
	assertEquals([threshold.status, threshold.errors], [422, {
		thresholdMinor: "The smallest payout is 10.00 USD.",
	}]);
	const destination = payoutScheduleRefusal({
		code: "PA403",
		message: "destinationId: that payout account can't receive payouts — choose another",
	});
	assertEquals(Object.keys(destination.errors ?? {}), ["destinationId"]);
});

Deno.test("enrolling in the smoother is locked while it is planned; leaving it never is", async () => {
	const enrol = await enrolSmoother({ targetMonthlyMinor: 300_000, currency: "USD" }, QUERY, ACTOR);
	assertEquals([enrol.status, enrol.details], [409, { reason: "smoother_planned" }]);
	assertEquals(enrol.message, LOCK_REASON.smoother_planned);
	// Leaving passes the lock and reaches the sign-in check (this actor carries no session).
	const leave = await enrolSmoother(
		{ targetMonthlyMinor: 300_000, currency: "USD", enrol: false },
		QUERY,
		{ ...ACTOR, accessToken: undefined } as unknown as ReadActor,
	);
	assertEquals(leave.status, 401);
});
// #endregion

// #region N17: the schedule of the currency the action names
const TWO_CURRENCIES: WalletAccount = {
	...PERSONAL,
	rows: [
		{ ...PERSONAL.rows[0], id: "w-gbp", currency: "GBP", balance_cents: 90_000 },
		{ ...PERSONAL.rows[0], id: "w-eur", currency: "EUR", balance_cents: 10_000 },
	],
};

/** The arguments a save would send the door; a refusal fails the test. */
function scheduleOf(account: WalletAccount, input: PayoutScheduleInput) {
	const out = payoutScheduleArgs(account, input);
	assert(!("ok" in out), `refused: ${"message" in out ? out.message : ""}`);
	return out;
}

Deno.test("a multi-currency account saves the schedule in the currency it named", () => {
	assertEquals(scheduleOf(TWO_CURRENCIES, { ...SCHEDULE, currency: "eur" }).p_currency, "EUR");
	assertEquals(
		scheduleOf(TWO_CURRENCIES, {
			...SCHEDULE,
			currency: "GBP",
			mode: "threshold",
			thresholdMinor: 25_000,
		}),
		{
			p_owner_type: "user",
			p_owner_id: "u-1",
			p_currency: "GBP",
			p_mode: "threshold",
			p_threshold_cents: 25_000,
			p_destination_method_id: null,
			p_instant: false,
		},
	);
	assertEquals(
		scheduleOf(PERSONAL, { ...SCHEDULE, mode: "scheduled_weekly", thresholdMinor: 25_000 })
			.p_threshold_cents,
		null,
		"only a threshold schedule carries a threshold",
	);
	const absent = payoutScheduleArgs(TWO_CURRENCIES, { ...SCHEDULE, currency: "USD" });
	assertEquals(["ok" in absent && absent.ok, "status" in absent && absent.status], [false, 409]);
});

Deno.test("a missing currency is the wallet's only one, and on a multi-currency wallet fails closed", () => {
	assertEquals(scheduleOf(PERSONAL, SCHEDULE).p_currency, "USD", "one currency: nothing to guess");
	const unnamed = payoutScheduleArgs(TWO_CURRENCIES, SCHEDULE);
	assert("ok" in unnamed && !unnamed.ok, "two currencies: refused, never a guess");
	assertEquals(unnamed.status, 422);
	assertEquals(
		unnamed.message,
		"This account holds more than one currency. Choose which one these payouts are for.",
	);
	assertEquals(Object.keys(unnamed.errors ?? {}), ["currency"]);
});
// #endregion

// #region Recurring rules (FCA A13)
Deno.test("each recurring-rule action asks the door for its one change", () => {
	const target = {
		scope: "personal" as const,
		contextId: "",
		ruleId: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
	};
	assertEquals(recurringChange({ ...target, action: "pause_recurring" }).args, { p_active: false });
	assertEquals(recurringChange({ ...target, action: "resume_recurring" }).args, { p_active: true });
	assertEquals(
		recurringChange({ ...target, action: "edit_recurring", amountMinor: 7_500, currency: "USD" })
			.args,
		{ p_amount_cents: 7_500 },
	);
	assertEquals(recurringChange({ ...target, action: "archive_recurring" }).args, {
		p_archive: true,
	});
});

Deno.test("a resume or a new amount says the charge now runs on the editor's authority", () => {
	const target = {
		scope: "personal" as const,
		contextId: "",
		ruleId: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
	};
	const consent = /on your authority/;
	assert(consent.test(recurringChange({ ...target, action: "resume_recurring" }).message));
	assert(
		consent.test(
			recurringChange({ ...target, action: "edit_recurring", amountMinor: 7_500, currency: "USD" })
				.message,
		),
	);
	// Stopping a charge needs no consent, and says none.
	assertEquals(
		recurringChange({ ...target, action: "pause_recurring" }).message,
		"Recurring deposit paused.",
	);
	assertEquals(
		recurringChange({ ...target, action: "archive_recurring" }).message,
		"Recurring deposit removed.",
	);
});
// #endregion

Deno.test("a pot save asks the door for exactly the pot named, on the wallet resolved", () => {
	const args = savePotArgs({
		scope: "personal",
		contextId: "",
		currency: "USD",
		potId: null,
		purpose: "tax",
		name: "Tax set-aside",
		autoAllocateBp: null,
		goalMinor: null,
	}, "w-own");
	assertEquals(args, {
		p_wallet: "w-own",
		p_id: null,
		p_purpose: "tax",
		p_name: "Tax set-aside",
		p_auto_allocate_bp: null,
		p_goal_cents: null,
		p_archive: false,
	}, "a null share lets the door apply the tax default");
	const archive = savePotArgs({
		scope: "team",
		contextId: "t-1",
		currency: "GBP",
		potId: "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
		purpose: "savings",
		name: "Reserve",
		autoAllocateBp: 1500,
		goalMinor: 500_000,
		archive: true,
	}, "w-vault");
	assertEquals(
		[archive.p_id, archive.p_auto_allocate_bp, archive.p_goal_cents, archive.p_archive],
		[
			"6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
			1500,
			500_000,
			true,
		],
	);
});