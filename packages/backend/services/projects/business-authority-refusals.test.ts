import { assertEquals } from "@std/assert";
import { settlementRefusal } from "./live-settlement.ts";
import { refusalFrom } from "./live-writes.ts";

// The project doors' mappers answer BB2's typed refusals as a 403 naming the missing capability, so a
// screen can word its own sentence (BU6) instead of showing the raw `missing_permission:` text.

Deno.test("refusalFrom: a missing business capability is a 403 with details.reason", () => {
	const refusal = refusalFrom("missing_permission: hire", "applicationId");
	assertEquals(refusal.status, 403);
	assertEquals(refusal.details, { reason: "hire" });
	assertEquals(refusal.errors, { applicationId: "hire" });

	assertEquals(refusalFrom("missing_permission: manage_projects", "title").details, {
		reason: "manage_projects",
	});
});

Deno.test("settlementRefusal: an approval without `hire` is a 403, not a generic failure", () => {
	const refusal = settlementRefusal(
		{ code: "PK403", message: "missing_permission: hire" },
		"stageId",
	);
	assertEquals(refusal.status, 403);
	assertEquals(refusal.details, { reason: "hire" });
});
