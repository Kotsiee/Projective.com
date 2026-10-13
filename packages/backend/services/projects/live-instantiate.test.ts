import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DRAFT_IDLE_MS, PipelineDraftSchema } from "@projective/types/services";
import { DRAFT_JSON_KEYS, instantiateRefusal, toPipelineDraft } from "./live-instantiate.ts";

/*
 * The instantiate doors answer in jsonb whose keys are the SQL projection's
 * (`marketplace.fn_service_draft_json`, 00001175). A renamed key would read as a silent zero — a
 * draft that says it has no stages, or one the sweep will never archive — so the mapper is pinned
 * here and the keys and RPC parameters it relies on are checked against the migration text.
 */

const MIGRATION = new URL(
	"../../../../supabase/migrations/00001175_functions_marketplace_instantiate.sql",
	import.meta.url,
);
const MODULE = new URL("./live-instantiate.ts", import.meta.url);

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		project_id: "1c0bac65-0f95-4298-9586-964d1aca4fbc",
		slug: "prj-9gvtno5ne3",
		title: "Design-system foundation",
		status: "draft",
		source_blueprint_slug: "svc-y2rf7cgefy",
		stage_count: 4,
		ticket_count: 4,
		funded_stage_count: 0,
		currency: "USD",
		created_at: "2026-10-13T17:58:13.559853+00:00",
		last_activity_at: "2026-10-13T17:58:13.559853+00:00",
		created: true,
		...over,
	};
}

// #region Projection
Deno.test("a fresh draft maps by its own keys, addressed by slug, with the sweep's deadline", () => {
	const d = toPipelineDraft(payload(), "svc-fallback");
	assertEquals(d.projectId, "prj-9gvtno5ne3");
	assertEquals(d.slug, "prj-9gvtno5ne3");
	assertEquals(d.boardHref, "/projects/prj-9gvtno5ne3/board");
	assertEquals(d.sourceServiceId, "svc-y2rf7cgefy");
	assertEquals([d.stageCount, d.fundedStageCount], [4, 0]);
	assertEquals(d.status, "draft");
	assertEquals(d.lastActivityAt, Date.parse("2026-10-13T17:58:13.559853+00:00"));
	assertEquals(d.archivesAt, d.lastActivityAt + DRAFT_IDLE_MS);
	PipelineDraftSchema.parse(d);
});

Deno.test("funding removes the deadline; statuses outside the listing's three take the safe side", () => {
	assertEquals(toPipelineDraft(payload({ funded_stage_count: 1 }), "x").archivesAt, null);
	assertEquals(toPipelineDraft(payload({ status: "active" }), "x").status, "active");
	assertEquals(toPipelineDraft(payload({ status: "on_hold" }), "x").status, "active");
	for (const status of ["archived", "completed", "cancelled", "weird", null]) {
		const d = toPipelineDraft(payload({ status }), "x");
		assertEquals(d.status, "archived", String(status));
		assertEquals(d.archivesAt, null);
	}
});

Deno.test("a draft whose listing is gone still names a source, and counts never read negative", () => {
	const d = toPipelineDraft(
		payload({ source_blueprint_slug: null, stage_count: "3", funded_stage_count: -2 }),
		"",
	);
	assertEquals(d.sourceServiceId, "prj-9gvtno5ne3");
	assertEquals([d.stageCount, d.fundedStageCount], [3, 0]);
	PipelineDraftSchema.parse(d);
});
// #endregion

// #region Refusals
Deno.test("every door refusal maps by SQLSTATE to the status and field the UI renders", () => {
	const cases: Array<[string, string, number, string, string]> = [
		["28000", "Sign in to add this to your projects.", 401, "", ""],
		[
			"PM403",
			"age: buying and selling unlock on the account holder's 18th birthday",
			403,
			"serviceId",
			"age_restricted",
		],
		["P0002", "That service is not available.", 404, "serviceId", "not_found"],
		["PU422", "You can't add your own service to your projects.", 422, "serviceId", "own_listing"],
		["PC409", "This service is priced in USD.", 409, "currency", "currency_mismatch"],
		[
			"23514",
			"This project has funded work in it and cannot be archived from here.",
			409,
			"projectId",
			"has_funded_stages",
		],
		[
			"22023",
			"Only a pipeline service can be added to your projects.",
			422,
			"serviceId",
			"not_a_pipeline",
		],
		["22023", "This service has no stages to add yet.", 422, "serviceId", "no_stages"],
		[
			"22023",
			"This request key was already used for a different service.",
			422,
			"idempotencyKey",
			"key_reused",
		],
		["22023", "The answers to this service's questions are malformed.", 422, "answers", "invalid"],
	];
	for (const [code, message, status, field, value] of cases) {
		const r = instantiateRefusal({ code, message });
		assertEquals(r.status, status, `${code} ${message}`);
		if (field) assertEquals(r.errors?.[field], value, `${code} ${message}`);
	}
	// The door's own sentence reaches the buyer; the age gate's internal prefix does not.
	assertEquals(
		instantiateRefusal({ code: "PC409", message: "This service is priced in USD." }).message,
		"This service is priced in USD.",
	);
	assert(!instantiateRefusal({ code: "PM403", message: "age: x" }).message.startsWith("age:"));
});

Deno.test("a GRANT-level refusal never names the function it failed on", () => {
	const r = instantiateRefusal({
		code: "42501",
		message: "permission denied for function instantiate_service_blueprint",
	});
	assertEquals(r.status, 403);
	assert(!r.message.includes("instantiate_service_blueprint"));
});
// #endregion

// #region Pinned against the migration
Deno.test("the projection's keys and the doors' parameters exist in 00001175", async () => {
	const sql = await Deno.readTextFile(MIGRATION);
	const source = await Deno.readTextFile(MODULE);
	for (const key of DRAFT_JSON_KEYS) assertStringIncludes(sql, `'${key}'`, `projection key ${key}`);
	for (
		const signature of [
			"marketplace.instantiate_service_blueprint (\r\n    p_blueprint_id uuid,",
			"marketplace.get_service_draft (p_blueprint_id uuid)",
			"marketplace.archive_service_draft (p_project_slug text, p_reason text DEFAULT NULL)",
		]
	) {
		assertStringIncludes(sql.replaceAll("\r\n", "\n"), signature.replaceAll("\r\n", "\n"));
	}
	for (
		const param of ["p_intake jsonb", "p_currency text", "p_idempotency_key text", "p_title text"]
	) {
		assertStringIncludes(sql, param);
	}
	for (
		const param of [
			"p_blueprint_id:",
			"p_intake:",
			"p_currency:",
			"p_idempotency_key:",
			"p_title:",
			"p_project_slug:",
			"p_reason:",
		]
	) {
		assertStringIncludes(source, param, `the module sends ${param}`);
	}
	// Every code the mapper names is one the doors raise (PM403 arrives from `org.fn_assert_adult`).
	for (const code of ["'28000'", "'P0002'", "'PU422'", "'PC409'", "'22023'", "'23514'"]) {
		assertStringIncludes(sql, code, `00001175 raises ${code}`);
	}
	assertStringIncludes(sql, "org.fn_assert_adult(v_owner)");
});
// #endregion
