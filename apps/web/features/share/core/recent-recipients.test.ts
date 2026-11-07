import { assertEquals } from "@std/assert";
import type { RankedContact } from "@projective/types/messaging";
import { recentRecipients } from "./recent-recipients.ts";

function contact(
	id: string,
	lastInteractionAt: string | null,
	tier: RankedContact["tier"] = "follows",
): RankedContact {
	return {
		id,
		name: id,
		avatar: null,
		handle: id,
		context: null,
		relation: "dm",
		online: false,
		tier,
		reason: null,
		lastInteractionAt,
		lastInteractionLabel: null,
	};
}

Deno.test("recent recipients are the newest three interactions, whatever their tier", () => {
	const people = [
		contact("teammate", null, "shared_entity"),
		contact("old", "2026-01-01T00:00:00Z", "collaborated"),
		contact("newest", "2026-11-07T00:00:00Z", "conversed"),
		contact("middle", "2026-06-01T00:00:00Z", "mutual_follow"),
		contact("recent", "2026-10-01T00:00:00Z", "conversed"),
		contact("garbled", "not a date"),
	];
	assertEquals(recentRecipients(people).map((c) => c.id), ["newest", "recent", "middle"]);
});

Deno.test("recent recipients leave the ranked list as it was", () => {
	const people = [contact("a", "2026-01-01T00:00:00Z"), contact("b", "2026-02-01T00:00:00Z")];
	recentRecipients(people);
	assertEquals(people.map((c) => c.id), ["a", "b"]);
});
