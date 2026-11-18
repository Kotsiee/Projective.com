import { assertEquals } from "@std/assert";
import { messageTargetOf } from "./live-catalog.ts";

/**
 * Who a discovery owner's Message reaches (Decision #422 (b)): a team's or a business's owner as
 * `org.profiles_index.contact_*` names them, nobody for a person (their own recipient), and nobody
 * when an entity's row names no owner — never the entity's own slug.
 */

Deno.test("messageTargetOf — a team's and a business's owner", () => {
	for (const entity_type of ["team", "business"] as const) {
		assertEquals(
			messageTargetOf({ entity_type, contact_handle: "kwamemensah", contact_name: "Kwame Mensah" }),
			{ handle: "@kwamemensah", name: "Kwame Mensah" },
			entity_type,
		);
	}
});

Deno.test("messageTargetOf — an owner with no name is titled by their handle", () => {
	assertEquals(
		messageTargetOf({ entity_type: "business", contact_handle: "priyaraman", contact_name: null }),
		{ handle: "@priyaraman", name: "priyaraman" },
	);
	assertEquals(
		messageTargetOf({ entity_type: "team", contact_handle: " priyaraman ", contact_name: "  " }),
		{ handle: "@priyaraman", name: "priyaraman" },
	);
});

Deno.test("messageTargetOf — nobody for a person, or an entity naming no owner", () => {
	for (const entity_type of ["user", "freelancer"] as const) {
		assertEquals(
			messageTargetOf({ entity_type, contact_handle: "someone", contact_name: "Someone" }),
			undefined,
			entity_type,
		);
	}
	assertEquals(
		messageTargetOf({ entity_type: "team", contact_handle: null, contact_name: null }),
		undefined,
	);
	assertEquals(messageTargetOf({ entity_type: "business" }), undefined);
	assertEquals(messageTargetOf({ entity_type: "team", contact_handle: "   " }), undefined);
});
