import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	accessOf,
	isClosedStatus,
	landingFor,
	previewAllowed,
	type ProjectAccess,
	workspaceExitFor,
} from "./access.ts";
import { ProjectStatus } from "./summary.ts";

const STATUSES = ProjectStatus.options;
const PUBLISHED = STATUSES.filter((s) => s !== "draft");

Deno.test("the client side is the owner, whatever the access predicate says", () => {
	assertEquals(accessOf(true, true), "owner");
	// A client-side seat whose access row is unreadable is still the client: viewerIsClient decides.
	assertEquals(accessOf(true, false), "owner");
});

Deno.test("access without the client side is participation; neither is a prospect", () => {
	assertEquals(accessOf(false, true), "participant");
	assertEquals(accessOf(false, false), "prospect");
});

Deno.test("an owner's draft lands on the configuration; every other owner status on the Overview", () => {
	assertEquals(landingFor("owner", "draft"), { kind: "details" });
	for (const status of PUBLISHED) {
		assertEquals(landingFor("owner", status), { kind: "overview", viewer: "owner" }, status);
	}
});

Deno.test("a participant lands on the Overview in every status, the draft included", () => {
	// A seat accepted on a draft is staged (Decision #139): its holder still has a workspace to open.
	for (const status of STATUSES) {
		assertEquals(landingFor("participant", status), { kind: "overview", viewer: "participant" });
	}
});

Deno.test("a prospect is sent to the listing, or told a draft does not exist", () => {
	assertEquals(landingFor("prospect", "draft"), { kind: "missing" });
	for (const status of PUBLISHED) {
		assertEquals(landingFor("prospect", status), { kind: "listing" }, status);
	}
});

Deno.test("the dispatch matrix is total: every access × status cell has exactly one landing", () => {
	const accesses: ProjectAccess[] = ["owner", "participant", "prospect"];
	for (const access of accesses) {
		for (const status of STATUSES) {
			const landing = landingFor(access, status);
			assert(["overview", "details", "listing", "missing"].includes(landing.kind));
			// Nobody but the owner is ever sent to the configuration.
			if (landing.kind === "details") assertEquals(access, "owner");
			// A prospect never sees the Overview, in any status.
			if (access === "prospect") assert(landing.kind !== "overview");
		}
	}
});

Deno.test("only a prospect is moved off a workspace sub-path, and the root agrees with it", () => {
	for (const status of STATUSES) {
		assertEquals(workspaceExitFor("owner", status), null);
		assertEquals(workspaceExitFor("participant", status), null);
		const exit = workspaceExitFor("prospect", status);
		assertEquals(exit, landingFor("prospect", status).kind);
	}
});

Deno.test("a draft previews only once its ladder is done; a published project always previews", () => {
	assertFalse(previewAllowed("draft", false));
	assert(previewAllowed("draft", true));
	for (const status of PUBLISHED) {
		assert(previewAllowed(status, false), status);
		assert(previewAllowed(status, true), status);
	}
});

Deno.test("completed and cancelled are closed; nothing else is", () => {
	assert(isClosedStatus("completed"));
	assert(isClosedStatus("cancelled"));
	for (const status of ["draft", "active", "on_hold"] as const) assertFalse(isClosedStatus(status));
});
