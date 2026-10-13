import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { FairExitPreviewSchema, StageExitedSchema } from "@projective/types/projects";
import { fairExitMessage, toFairExitPreview, toStageExited } from "./live-settlement.ts";

/*
 * The Fair Exit read and door answer in jsonb whose keys are the SQL function's (Decision #198). A
 * renamed key would read as a silent zero on a confirmation about money, so the mappers are pinned
 * here and the keys they read are checked against the migration text.
 */

// #region Fixtures
const QUOTES = [
	{
		tier: 75,
		ticket_count: 2,
		held_cents: 4500000,
		prepaid_cents: 0,
		freelancer_paid_cents: 3206250,
		fee_cents: 168750,
		client_refunded_cents: 1125000,
	},
	{
		tier: 25,
		ticket_count: 2,
		held_cents: 4500000,
		prepaid_cents: 0,
		freelancer_paid_cents: 1068750,
		fee_cents: 56250,
		client_refunded_cents: 3375000,
	},
	{
		tier: 50,
		ticket_count: 2,
		held_cents: 4500000,
		prepaid_cents: 0,
		freelancer_paid_cents: 2137500,
		fee_cents: 112500,
		client_refunded_cents: 2250000,
	},
];

function previewPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		stage_id: "2756102c-7332-4015-a56f-147ee334fc4f",
		stage_name: "Brand system",
		stage_status: "in_progress",
		currency: "usd",
		exitable: true,
		blocked: null,
		held_cents: 4500000,
		tickets_to_cancel: 2,
		tiers: QUOTES,
		...over,
	};
}
// #endregion

// #region Preview
Deno.test("the preview maps every tier by its own key, in tier order, labelled server-side", () => {
	const p = toFairExitPreview(previewPayload(), "stg");
	assertEquals(p.tiers.map((q) => q.tier), [25, 50, 75]);
	const half = p.tiers[1];
	assertEquals(
		[half.freelancerPaidCents, half.feeCents, half.clientRefundedCents],
		[2137500, 112500, 2250000],
	);
	assertStringIncludes(half.freelancerPaidLabel, "21,375.00");
	assertStringIncludes(half.clientRefundedLabel, "22,500.00");
	assertEquals(p.currency, "USD");
	assertEquals(p.exitable, true);
	assertEquals(p.ticketsToCancel, 2);
	assertStringIncludes(p.heldLabel, "45,000.00");
	FairExitPreviewSchema.parse(p);
});

Deno.test("a tier the function did not answer reads as an empty quote, never a neighbour's", () => {
	const p = toFairExitPreview(previewPayload({ tiers: [QUOTES[0]] }), "stg");
	assertEquals(p.tiers[0].freelancerPaidCents, 0);
	assertEquals(p.tiers[2].freelancerPaidCents, 3206250);
	FairExitPreviewSchema.parse(p);
});

Deno.test("a blocked preview is never exitable, whatever the flag says", () => {
	for (const blocked of ["settled", "nothing_held"] as const) {
		const p = toFairExitPreview(previewPayload({ blocked, exitable: true }), "stg");
		assertEquals(p.exitable, false, blocked);
		assertEquals(p.blocked, blocked);
	}
	assertEquals(toFairExitPreview(previewPayload({ blocked: "weird" }), "stg").blocked, null);
	assertEquals(toFairExitPreview(previewPayload({ exitable: "true" }), "stg").exitable, false);
});

Deno.test("prepaid money is carried through from the quote", () => {
	const tiers = QUOTES.map((q) => ({ ...q, prepaid_cents: 2250000 }));
	const p = toFairExitPreview(previewPayload({ tiers }), "stg");
	assertEquals(p.prepaidCents, 2250000);
	assertStringIncludes(p.prepaidLabel, "22,500.00");
});

Deno.test("an empty answer degrades to zeros and a safe name, still schema-valid", () => {
	const p = toFairExitPreview({}, "stg");
	assertEquals(p.exitable, false);
	assertEquals(p.stageName, "This stage");
	assertEquals(p.currency, "USD");
	FairExitPreviewSchema.parse(p);
});
// #endregion

// #region Door
Deno.test("the door's answer maps onto StageExited", () => {
	const e = toStageExited(
		{
			tier: 50,
			cancelled_count: 2,
			tickets_cancelled: 3,
			freelancer_paid_cents: "2137500",
			fee_cents: 112500,
			client_refunded_cents: 2250000,
			currency: "GBP",
			stage_status: "cancelled",
		},
		"stg",
		50,
	);
	assertEquals(e, {
		stageId: "stg",
		status: "cancelled",
		tier: 50,
		cancelledCount: 2,
		ticketsCancelled: 3,
		freelancerPaidCents: 2137500,
		feeCents: 112500,
		clientRefundedCents: 2250000,
		currency: "GBP",
	});
	StageExitedSchema.parse(e);
});

Deno.test("the notice names the money that moved and the tickets it closed", () => {
	const base = toStageExited(
		{
			freelancer_paid_cents: 2137500,
			client_refunded_cents: 2250000,
			currency: "USD",
		},
		"stg",
		50,
	);
	assertEquals(
		fairExitMessage(base),
		"Stage ended — US$21,375.00 paid to the freelancer, US$22,500.00 refunded.",
	);
	assertStringIncludes(
		fairExitMessage({ ...base, ticketsCancelled: 1 }),
		"; 1 open ticket was cancelled.",
	);
	assertStringIncludes(
		fairExitMessage({ ...base, ticketsCancelled: 4 }),
		"; 4 open tickets were cancelled.",
	);
});
// #endregion

// #region Contract with the SQL
const REPO = new URL("../../../../", import.meta.url);
const SQL = "supabase/migrations/00001150_functions_projects_stage_funding_submissions.sql";

function functionBody(sql: string, signature: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
	assert(start >= 0, `${signature} is no longer defined in ${SQL}`);
	const end = sql.indexOf("\n$$", start + signature.length);
	assert(end > start, `${signature} has no terminating $$`);
	return sql.slice(start, end);
}

Deno.test("every key the mappers read is one the SQL emits", () => {
	const sql = Deno.readTextFileSync(new URL(SQL, REPO));
	const quote = functionBody(sql, "projects.fn_fair_exit_quote(");
	const preview = functionBody(sql, "projects.preview_stage_fair_exit(");
	const door = functionBody(sql, "projects.cancel_stage_fair_exit(");
	for (
		const key of [
			"tier",
			"ticket_count",
			"prepaid_cents",
			"freelancer_paid_cents",
			"fee_cents",
			"client_refunded_cents",
		]
	) {
		assertStringIncludes(quote, `'${key}'`, `fn_fair_exit_quote does not emit "${key}"`);
	}
	for (
		const key of [
			"stage_name",
			"currency",
			"exitable",
			"blocked",
			"held_cents",
			"tickets_to_cancel",
			"tiers",
		]
	) {
		assertStringIncludes(preview, `'${key}'`, `preview_stage_fair_exit does not emit "${key}"`);
	}
	for (
		const key of [
			"cancelled_count",
			"tickets_cancelled",
			"freelancer_paid_cents",
			"fee_cents",
			"client_refunded_cents",
			"currency",
		]
	) {
		assertStringIncludes(door, `'${key}'`, `cancel_stage_fair_exit does not emit "${key}"`);
	}
	assertStringIncludes(preview, "'settled'");
	assertStringIncludes(preview, "'nothing_held'");
});

Deno.test("the preview is callable by a signed-in user, the quote by nobody", () => {
	const grants = Deno.readTextFileSync(
		new URL("supabase/migrations/00002510_permissions_function_grants.sql", REPO),
	);
	assert(
		/GRANT EXECUTE ON FUNCTION projects\.preview_stage_fair_exit \(uuid, uuid\) TO authenticated;/
			.test(grants),
	);
	assert(!/GRANT EXECUTE ON FUNCTION projects\.fn_fair_exit_quote/.test(grants));
});
// #endregion
