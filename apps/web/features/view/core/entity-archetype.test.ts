import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1";
import {
	ownerShortName,
	sessionBookingNoteFor,
	type SessionFacts,
	sessionTrackFor,
} from "./entity-archetype.ts";

function sessionView(service: NonNullable<SessionFacts["service"]>): SessionFacts {
	return { service };
}

Deno.test("sessionTrackFor: the plan's rows, extended to every scheduled sitting", () => {
	const plan = [{ index: 1, title: "Discovery", description: "" }, {
		index: 2,
		title: "",
		description: "",
	}];
	assertEquals(sessionTrackFor(sessionView({ sessionPlan: plan })), plan);
	assertEquals(sessionTrackFor(sessionView({ sessionPlan: plan }), 3), [
		...plan,
		{ index: 3, title: "", description: "" },
	]);
	assertEquals(sessionTrackFor(sessionView({})), []);
});

Deno.test("sessionBookingNoteFor: a block, an ongoing listing and a cohort each say what booking commits to", () => {
	assertStringIncludes(
		sessionBookingNoteFor(sessionView({ sessionCount: 4 }), "session"),
		"session 1",
	);
	assertStringIncludes(
		sessionBookingNoteFor(sessionView({ sessionRolling: true }), "session"),
		"no fixed number",
	);
	assertStringIncludes(sessionBookingNoteFor(sessionView({}), "cohort"), "every sitting");
});

Deno.test("ownerShortName: a person is named by their first name", () => {
	assertEquals(ownerShortName({ name: "Chloe Winters", kind: "freelancer" }), "Chloe");
	assertEquals(ownerShortName({ name: "  Juno  Park ", kind: "user" }), "Juno");
});

Deno.test("ownerShortName: a team or business keeps its full name", () => {
	assertEquals(ownerShortName({ name: "North Studio", kind: "team" }), "North Studio");
	assertEquals(
		ownerShortName({ name: "Bright Harbour Ltd", kind: "business" }),
		"Bright Harbour Ltd",
	);
});
