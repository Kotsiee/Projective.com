import { assertEquals } from "jsr:@std/assert@^1";
import { ownerShortName } from "./entity-archetype.ts";

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
