import { assertEquals } from "@std/assert";
import type { RankedContact } from "@features/messaging/types/messaging-types.ts";
import {
	gridMove,
	pinnedPeople,
	sendLabel,
	sendSummary,
	SHARE_SEND_MAX,
	toggleRecipient,
} from "./share-select.ts";

const person = (id: string, name = id): RankedContact => ({
	id,
	name,
	avatar: null,
	handle: id,
	context: null,
	relation: "dm",
	online: false,
	tier: "none",
	reason: null,
	lastInteractionAt: null,
	lastInteractionLabel: null,
});

Deno.test("select: a press adds or removes one person; past the cap it is refused", () => {
	assertEquals(toggleRecipient([], "a"), { selected: ["a"], refused: null });
	assertEquals(toggleRecipient(["a", "b"], "a"), { selected: ["b"], refused: null });
	const full = Array.from({ length: SHARE_SEND_MAX }, (_, i) => `p${i}`);
	const over = toggleRecipient(full, "x");
	assertEquals(over.selected, full);
	assertEquals(over.refused, `Send to up to ${SHARE_SEND_MAX} people at a time.`);
});

Deno.test("select: chosen people a search leaves out are pinned ahead, in the order chosen", () => {
	const known = new Map([["a", person("a")], ["c", person("c")]]);
	assertEquals(pinnedPeople([person("b"), person("c")], ["a", "c"], known).map((p) => p.id), ["a"]);
	assertEquals(pinnedPeople([person("a")], ["a"], known), []);
	assertEquals(pinnedPeople([], ["z"], known), []);
});

Deno.test("grid: arrows move by one and by a row, clamped; other keys do nothing", () => {
	assertEquals(gridMove(0, "ArrowRight", 6, 4), 1);
	assertEquals(gridMove(0, "ArrowLeft", 6, 4), 0);
	assertEquals(gridMove(1, "ArrowDown", 6, 4), 5);
	assertEquals(gridMove(3, "ArrowDown", 6, 4), 5);
	assertEquals(gridMove(5, "ArrowUp", 6, 4), 1);
	assertEquals(gridMove(2, "End", 6, 4), 5);
	assertEquals(gridMove(2, "Home", 6, 4), 0);
	assertEquals(gridMove(2, "Enter", 6, 4), null);
	assertEquals(gridMove(0, "ArrowRight", 0, 4), null);
});

Deno.test("send: everyone reached is one toast; a refusal keeps who is left with the reason", () => {
	assertEquals(sendLabel(3), "Send to 3");
	const one = sendSummary([{ id: "a", name: "Ana", ok: true, message: null }]);
	assertEquals(one, { sent: ["a"], failed: [], toast: "Sent to Ana", error: null });
	const all = sendSummary([
		{ id: "a", name: "Ana", ok: true, message: null },
		{ id: "b", name: "Bo", ok: true, message: null },
	]);
	assertEquals(all.toast, "Sent to 2 people");
	const part = sendSummary([
		{ id: "a", name: "Ana", ok: true, message: null },
		{ id: "b", name: "Bo", ok: false, message: null },
	]);
	assertEquals(part, {
		sent: ["a"],
		failed: ["b"],
		toast: null,
		error: "Couldn't reach Bo — try again.",
	});
	const two = sendSummary([
		{ id: "a", name: "Ana", ok: false, message: "Blocked" },
		{ id: "b", name: "Bo", ok: false, message: null },
	]);
	assertEquals(two.error, "Couldn't reach 2 people — try again.");
});
