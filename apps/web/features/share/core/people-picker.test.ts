import { assertEquals } from "@std/assert";
import type { RankedContact } from "@projective/types/messaging";
import {
	canAct,
	contactMeta,
	emailFromQuery,
	handleSet,
	normaliseHandle,
	withoutHandles,
} from "./people-picker.ts";

function contact(over: Partial<RankedContact>): RankedContact {
	return {
		id: "c-1",
		name: "Juno Park",
		avatar: null,
		handle: "juno",
		context: null,
		relation: "dm",
		online: false,
		tier: "follows",
		reason: null,
		lastInteractionAt: null,
		lastInteractionLabel: null,
		...over,
	};
}

Deno.test("only an idle row can be acted on", () => {
	assertEquals(canAct("idle"), true);
	assertEquals(canAct("busy"), false);
	assertEquals(canAct("done"), false);
	assertEquals(canAct("blocked"), false);
});

Deno.test("the meta line is the handle then the relationship, each only when it exists", () => {
	assertEquals(contactMeta(contact({})), "@juno · Following");
	assertEquals(contactMeta(contact({ tier: "none" })), "@juno");
	assertEquals(contactMeta(contact({ handle: null, tier: "collaborated" })), "Worked together");
	assertEquals(contactMeta(contact({ handle: "@Juno" })), "@juno · Following");
});

Deno.test("handles compare without the @ and without case", () => {
	assertEquals(normaliseHandle("@Juno"), "juno");
	assertEquals(normaliseHandle("  "), null);
	assertEquals(normaliseHandle(null), null);
	assertEquals([...handleSet([{ handle: "@Kenji" }, { handle: null }, null])], ["kenji"]);
});

Deno.test("members and handle-less contacts are left out of the suggestions", () => {
	const kept = withoutHandles(
		[
			contact({ id: "a", handle: "juno" }),
			contact({ id: "b", handle: "Kenji" }),
			contact({
				id: "c",
				handle: null,
			}),
		],
		new Set(["kenji"]),
	);
	assertEquals(kept.map((c) => c.id), ["a"]);
});

Deno.test("an email query is recognised, lowercased, and anything else is not", () => {
	assertEquals(emailFromQuery(" Casey@Studio.co "), "casey@studio.co");
	assertEquals(emailFromQuery("casey"), null);
	assertEquals(emailFromQuery("@casey"), null);
});
