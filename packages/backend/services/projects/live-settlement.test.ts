import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
	FairExitPreviewSchema,
	ProjectCancelledSchema,
	ProjectCancelPreviewSchema,
	ProjectCompletedSchema,
	ProjectCompletePreviewSchema,
	StageExitedSchema,
} from "@projective/types/projects";
import {
	fairExitMessage,
	projectCancelledMessage,
	projectCompletedMessage,
	settlementRefusal,
	toFairExitPreview,
	toProjectCancelled,
	toProjectCancelPreview,
	toProjectCompleted,
	toProjectCompletePreview,
	toStageExited,
} from "./live-settlement.ts";

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
	assertStringIncludes(
		functionBody(sql, "projects.fn_fair_exit_quote("),
		"projects.fn_fair_exit_quote_scoped(p_stage_id, p_tier, false)",
		"fn_fair_exit_quote no longer quotes every held ticket",
	);
	const quote = functionBody(sql, "projects.fn_fair_exit_quote_scoped(");
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
	assert(
		/REVOKE ALL ON FUNCTION projects\.fn_fair_exit_quote_scoped \(uuid, integer, boolean\) FROM PUBLIC, anon, authenticated, service_role;/
			.test(grants),
	);
});
// #endregion

// #region Cancelling an engagement (Decisions #456, #467)
const STAGE = "2756102c-7332-4015-a56f-147ee334fc4f";

Deno.test("the cancel preview maps a brief's answer, kind and blocked reason included", () => {
	const p = toProjectCancelPreview({
		project_id: "7f930a97-cfa8-4784-a7d0-61c913c2f3ce",
		kind: "project",
		status: "active",
		currency: "usd",
		cancellable: true,
		blocked: null,
		returned_cents: 100000,
		tickets_to_cancel: 4,
		stages: [
			{ stage_id: STAGE, stage_name: "Build", tiers: QUOTES },
			{ stage_id: "not-a-uuid", stage_name: "Dropped", tiers: QUOTES },
		],
	});
	ProjectCancelPreviewSchema.parse(p);
	assertEquals(p.kind, "project");
	assertEquals(p.currency, "USD");
	assertEquals(p.returnedCents, 100000);
	assertEquals(p.stages.length, 1, "a stage id that is not a uuid is dropped");
	assertEquals(p.stages[0].tiers.map((q) => q.tier), [25, 50, 75]);
	assertEquals(p.stages[0].tiers[0].freelancerPaidCents, 1068750);

	for (const blocked of ["ended", "dispute", "sittings", "settling"] as const) {
		const b = toProjectCancelPreview({
			kind: "service",
			cancellable: false,
			blocked,
			currency: "GBP",
		});
		assertEquals(b.blocked, blocked);
		assertEquals(b.cancellable, false);
		assertEquals(b.kind, "service");
	}
	const odd = toProjectCancelPreview({ cancellable: true, blocked: "frozen" });
	assertEquals(odd.blocked, null, "an unknown reason is not trusted");
	assertEquals(odd.kind, "project");
});

Deno.test("the cancel door's answer and its notice", () => {
	const c = toProjectCancelled({
		project_id: "x",
		kind: "project",
		status: "cancelled",
		currency: "USD",
		freelancer_paid_cents: 2137500,
		fee_cents: 112500,
		client_refunded_cents: 2350000,
		tickets_cancelled: 4,
		stages: [],
	});
	ProjectCancelledSchema.parse(c);
	assertEquals(c.freelancerPaidCents + c.feeCents + c.clientRefundedCents, 4600000);
	assertStringIncludes(projectCancelledMessage(c), "Project cancelled — ");
	assertStringIncludes(projectCancelledMessage(c), "paid for the work delivered");
	assertEquals(
		projectCancelledMessage({
			...c,
			kind: "service",
			freelancerPaidCents: 0,
			clientRefundedCents: 0,
		}),
		"Service cancelled.",
	);
	assertStringIncludes(
		projectCancelledMessage({ ...c, freelancerPaidCents: 0 }),
		"refunded to your wallet",
	);
});

Deno.test("an open dispute and money still held are 409s the dialog can name", () => {
	const dispute = settlementRefusal({
		code: "PD409",
		message: "dispute_open: this payment is held",
	}, "tiers");
	assertEquals(dispute.status, 409);
	assertEquals(dispute.errors, { tiers: "dispute_open" });
	const held = settlementRefusal({
		code: "PF409",
		message: "This engagement holds escrow for booked sittings, which settle through each sitting.",
	}, "tiers");
	assertEquals(held.status, 409);
	assertEquals(held.errors, { tiers: "settle_first" });
	assertStringIncludes(held.message, "booked sittings");
});

Deno.test("every key the cancel mappers read is one the SQL emits, through one settle-first helper", () => {
	const sql = Deno.readTextFileSync(new URL(SQL, REPO));
	const preview = functionBody(sql, "projects.preview_project_cancel(");
	const helper = functionBody(sql, "projects.fn_settle_project_escrow(");
	const door = functionBody(sql, "projects.cancel_project(");
	const service = functionBody(sql, "projects.cancel_service(");
	for (
		const key of [
			"kind",
			"currency",
			"cancellable",
			"blocked",
			"returned_cents",
			"tickets_to_cancel",
			"stages",
		]
	) {
		assertStringIncludes(preview, `'${key}'`, `preview_project_cancel does not emit "${key}"`);
	}
	for (
		const key of [
			"currency",
			"freelancer_paid_cents",
			"fee_cents",
			"client_refunded_cents",
			"tickets_cancelled",
		]
	) {
		assertStringIncludes(helper, `'${key}'`, `fn_settle_project_escrow does not emit "${key}"`);
	}
	assertStringIncludes(
		door,
		"projects.fn_settle_project_escrow(p_project_id, p_tiers)",
		"the door settles",
	);
	assertStringIncludes(door, "'kind'");
	assertStringIncludes(service, "projects.cancel_project(", "cancel_service is the same door");
	assertStringIncludes(helper, "finance.fn_assert_no_open_dispute", "a dispute refuses the cancel");
	const blocked = functionBody(sql, "projects.fn_project_cancel_blocked(");
	for (const reason of ["ended", "dispute", "sittings", "settling"]) {
		assertStringIncludes(
			blocked,
			`'${reason}'`,
			`fn_project_cancel_blocked never says "${reason}"`,
		);
	}

	const status = Deno.readTextFileSync(
		new URL("supabase/migrations/00001100_functions_projects_read_access.sql", REPO),
	);
	assertStringIncludes(
		status,
		"ERRCODE = 'PF409'",
		"set_project_status no longer refuses with PF409",
	);
	assertStringIncludes(status, "HINT = 'cancel'");
});

Deno.test("the cancel doors are callable by a signed-in user, the helper by nobody", () => {
	const grants = Deno.readTextFileSync(
		new URL("supabase/migrations/00002510_permissions_function_grants.sql", REPO),
	);
	assert(
		/GRANT EXECUTE ON FUNCTION projects\.preview_project_cancel \(uuid\) TO authenticated;/.test(
			grants,
		),
	);
	assert(
		/GRANT EXECUTE ON FUNCTION projects\.cancel_project \(uuid, jsonb, text\) TO authenticated;/
			.test(grants),
	);
	assert(!/GRANT EXECUTE ON FUNCTION projects\.fn_settle_project_escrow/.test(grants));
	assert(
		/REVOKE ALL ON FUNCTION projects\.fn_settle_project_escrow \(uuid, jsonb\) FROM PUBLIC, anon, authenticated, service_role;/
			.test(grants),
	);
});
// #endregion

// #region Completing an engagement (EX1, Decision #546)
Deno.test("the completion preview maps the function's keys and trusts no unknown reason", () => {
	const preview = toProjectCompletePreview({
		kind: "service",
		completable: true,
		blocked: null,
		tickets_to_close: 2,
		stages_to_close: "1",
	});
	assertEquals(preview, {
		kind: "service",
		completable: true,
		blocked: null,
		ticketsToClose: 2,
		stagesToClose: 1,
	});
	assert(ProjectCompletePreviewSchema.safeParse(preview).success);
	const held = toProjectCompletePreview({ kind: "project", completable: false, blocked: "held" });
	assertEquals([held.completable, held.blocked], [false, "held"]);
	const odd = toProjectCompletePreview({ completable: true, blocked: "something_new" });
	assertEquals(
		[odd.completable, odd.blocked],
		[true, null],
		"an unknown word is dropped, not shown",
	);
	const lying = toProjectCompletePreview({ completable: true, blocked: "dispute" });
	assertEquals(lying.completable, false, "a named block is never completable");
});

Deno.test("the completion answer and its notice", () => {
	const done = toProjectCompleted({
		kind: "project",
		status: "completed",
		tickets_closed: 1,
		stages_closed: 2,
	});
	assert(ProjectCompletedSchema.safeParse(done).success);
	assertEquals([done.ticketsClosed, done.stagesClosed], [1, 2]);
	assertStringIncludes(projectCompletedMessage(done), "1 unfunded ticket closed");
	assertEquals(
		projectCompletedMessage({ ...done, kind: "service", ticketsClosed: 0 }),
		"Service completed — its reviews are open.",
	);
});

Deno.test("the keys the completion mappers read are the functions' own", () => {
	const sql = Deno.readTextFileSync(
		new URL("supabase/migrations/00001100_functions_projects_read_access.sql", REPO),
	);
	for (
		const key of [
			"'completable'",
			"'blocked'",
			"'tickets_to_close'",
			"'stages_to_close'",
			"'tickets_closed'",
			"'stages_closed'",
		]
	) {
		assertStringIncludes(sql, key);
	}
});

Deno.test("the completion doors are callable by a signed-in user, the completer by nobody", () => {
	const grants = Deno.readTextFileSync(
		new URL("supabase/migrations/00002510_permissions_function_grants.sql", REPO),
	);
	for (
		const door of [
			"preview_project_complete (uuid)",
			"can_complete_project (uuid)",
			"complete_project (uuid, text)",
			"reopen_project (uuid, text)",
		]
	) {
		assertStringIncludes(grants, `GRANT EXECUTE ON FUNCTION projects.${door} TO authenticated;`);
	}
	assert(!/GRANT EXECUTE ON FUNCTION projects\.fn_complete_project/.test(grants));
	assert(!/GRANT EXECUTE ON FUNCTION projects\.fn_project_complete_blocked/.test(grants));
});
// #endregion
