/**
 * The create form's two backend seams: the availability probe (with alternatives for a taken handle)
 * and the create door's refusal mapping (the handle race and the plan's ownership cap).
 */
import { assertEquals } from "@std/assert";
import { HANDLE_REFUSALS } from "@projective/types/workspace";
import { readPlanGateDetails } from "@projective/types/finance";
import { fail } from "../ServiceResult.ts";
import type { RpcOutcome } from "./live-support.ts";
import { checkHandleWith, type RawHandleVerdict } from "./live-handle.ts";
import { createRefusal, HANDLE_RACE_REFUSAL } from "./live-writes.ts";

// #region The probe

/** A namespace where `taken` handles are held and everything else is free; it records every ask. */
function namespace(taken: readonly string[], broken: readonly string[] = []) {
	const asked: string[] = [];
	const probe = (handle: string): Promise<RpcOutcome<RawHandleVerdict>> => {
		asked.push(handle);
		if (broken.includes(handle)) return Promise.reject(new Error("socket hang up"));
		const held = taken.includes(handle);
		return Promise.resolve({
			ok: true,
			data: { handle, available: !held, reason: held ? HANDLE_REFUSALS.taken : null },
		});
	};
	return { asked, probe };
}

Deno.test("checkHandleWith: a free handle is one probe and no suggestions", async () => {
	const ns = namespace([]);
	const res = await checkHandleWith("northern-grid", ns.probe);
	assertEquals(res.data, {
		handle: "northern-grid",
		available: true,
		reason: null,
		suggestions: [],
	});
	assertEquals(ns.asked, ["northern-grid"]);
});

Deno.test("checkHandleWith: a taken handle offers the first three FREE alternatives, in order", async () => {
	const ns = namespace(["grid", "grid-hq", "grid-2"]);
	const res = await checkHandleWith("grid", ns.probe);
	assertEquals(res.data?.available, false);
	assertEquals(res.data?.reason, HANDLE_REFUSALS.taken);
	assertEquals(res.data?.suggestions, ["grid-co", "grid-3", "grid-4"]);
});

Deno.test("checkHandleWith: a candidate whose probe throws is skipped, not fatal", async () => {
	const ns = namespace(["grid"], ["grid-hq"]);
	const res = await checkHandleWith("grid", ns.probe);
	assertEquals(res.ok, true);
	assertEquals(res.data?.suggestions, ["grid-co", "grid-2", "grid-3"]);
});

Deno.test("checkHandleWith: a reserved or malformed handle gets no alternatives and no extra probes", async () => {
	for (const reason of [HANDLE_REFUSALS.reserved, HANDLE_REFUSALS.format, HANDLE_REFUSALS.short]) {
		const asked: string[] = [];
		const res = await checkHandleWith("teams", (handle) => {
			asked.push(handle);
			return Promise.resolve({ ok: true, data: { handle, available: false, reason } });
		});
		assertEquals(res.data?.suggestions, [], reason);
		assertEquals(asked, ["teams"], reason);
	}
});

Deno.test("checkHandleWith: the probe's own refusal is answered verbatim", async () => {
	const refusal = fail<never>(401, { message: "Sign in to manage your teams and businesses." });
	const res = await checkHandleWith("grid", () => Promise.resolve({ ok: false, refusal }));
	assertEquals(res, refusal);
});

// #endregion

// #region The create door's refusals

Deno.test("createRefusal: a 23505 is the handle race — a 409 keyed to handle", () => {
	const res = createRefusal(
		{ code: "23505", message: 'duplicate key value violates unique constraint "teams_slug_key"' },
		"team",
	);
	assertEquals(res.status, 409);
	assertEquals(res.message, HANDLE_RACE_REFUSAL);
	assertEquals(res.errors, { handle: HANDLE_RACE_REFUSAL });
});

Deno.test("createRefusal: the ownership cap is a 402 naming the kind's entitlement", () => {
	const message = "plan: your plan includes 3 teams — archive one or upgrade to create another";
	const team = createRefusal({ code: "55000", message }, "team");
	assertEquals(team.status, 402);
	assertEquals(readPlanGateDetails(team.details), {
		reason: "entitlement",
		entitlement: "teams_owned",
	});
	assertEquals(team.message?.startsWith("Your plan includes 3"), true);
	const business = createRefusal({ code: "55000", message }, "business");
	assertEquals(readPlanGateDetails(business.details)?.entitlement, "businesses_owned");
});

Deno.test("createRefusal: every other refusal is refusalFrom's", () => {
	const handle = createRefusal({ code: "22023", message: "handle: That handle is taken." }, "team");
	assertEquals([handle.status, handle.errors], [422, { handle: "That handle is taken." }]);
	const lifecycle = createRefusal(
		{ code: "55000", message: "business_not_active: publish the business first" },
		"business",
	);
	assertEquals(lifecycle.status, 409);
	assertEquals(readPlanGateDetails(lifecycle.details), null);
});

// #endregion
