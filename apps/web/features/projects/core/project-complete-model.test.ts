import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { canReopenEngagement, ProjectCompleteBlocked } from "@projective/types/projects";
import {
	projectCompleteBlockedText,
	projectCompleteConsequences,
	projectCompleteCopy,
} from "./project-complete-model.ts";

Deno.test("Reopen is the client side's, on a completed engagement only", () => {
	assert(canReopenEngagement("project", "owner", "completed"));
	assert(canReopenEngagement("service", "client", "completed"));
	assertFalse(
		canReopenEngagement("service", "freelancer", "completed"),
		"the seller never reopens",
	);
	assertFalse(canReopenEngagement("project", "member", "completed"));
	for (const status of ["draft", "active", "on_hold", "cancelled", "archived"] as const) {
		assertFalse(canReopenEngagement("project", "owner", status), `not from ${status}`);
	}
});

Deno.test("every blocked reason has words, naming the kind", () => {
	for (const reason of ProjectCompleteBlocked.options) {
		assert(projectCompleteBlockedText(reason, "service").length > 0, reason);
	}
	assertStringIncludes(projectCompleteBlockedText("held", "service"), "cancel the service");
	assertEquals(projectCompleteCopy("project").commit, "Complete project");
	assertEquals(projectCompleteCopy("service").reopen, "Reopen service");
});

Deno.test("the consequences count what closes", () => {
	const base = { kind: "project", completable: true, blocked: null } as const;
	assertEquals(projectCompleteConsequences({ ...base, ticketsToClose: 0, stagesToClose: 0 }), [
		"its reviews open",
	]);
	assertEquals(projectCompleteConsequences({ ...base, ticketsToClose: 2, stagesToClose: 1 }), [
		"2 unfunded tickets will be cancelled",
		"1 open stage will close",
		"its reviews open",
	]);
});
