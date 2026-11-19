import { assertEquals } from "@std/assert";
import { reviewRefusal, toReviewables, toReviewViewers } from "./reviews-model.ts";

// #region Refusals
Deno.test("reviews: every door refusal maps to its own status and keeps the database's sentence", () => {
	const cases: Array<[string, number]> = [
		["PT404", 404],
		["PT403", 403],
		["PM403", 403],
		["42501", 403],
		["PT409", 409],
		["PT410", 410],
		["PT422", 422],
		["22023", 422],
		["PT501", 501],
	];
	for (const [code, status] of cases) {
		const r = reviewRefusal({ code, message: "review refused: the review window closed" });
		assertEquals(r.ok, false);
		assertEquals(r.status, status, code);
		assertEquals(r.message, "The review window closed.", code);
	}
});

Deno.test("reviews: an unknown failure is a 503, never the raw error", () => {
	const r = reviewRefusal({ code: "XX000", message: "relation does not exist" });
	assertEquals(r.status, 503);
	assertEquals(r.message, "We couldn't reach reviews just now. Try again in a moment.");
});
// #endregion

// #region Reads
Deno.test("reviews: the viewer's actions are keyed by review and recased", () => {
	const out = toReviewViewers([{
		id: "11111111-1111-4111-8111-111111111111",
		can_edit: true,
		can_withdraw: true,
		can_reply: false,
		can_edit_reply: false,
		edit_href: "/projects/prj-abcdefghjk?review=prj-abcdefghjk",
	}]);
	assertEquals(out["11111111-1111-4111-8111-111111111111"], {
		canEdit: true,
		canReply: false,
		canEditReply: false,
		editHref: "/projects/prj-abcdefghjk?review=prj-abcdefghjk",
	});
});

Deno.test("reviews: a reviewable with no avatar maps to a null avatar, and junk input to nothing", () => {
	const items = toReviewables([{
		anchor_kind: "project",
		anchor_id: "22222222-2222-4222-8222-222222222222",
		target_type: "freelancer",
		target_id: "33333333-3333-4333-8333-333333333333",
		target: { name: "Juno Park", handle: "@juno", avatar: null },
		opened_at: "2026-11-16T10:00:00Z",
		closes_at: "2026-12-16T10:00:00Z",
		open: true,
		review: null,
	}]);
	assertEquals(items.length, 1);
	assertEquals(items[0].target?.avatar, null);
	assertEquals(toReviewables(null), []);
});
// #endregion
