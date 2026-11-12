import { assertEquals } from "@std/assert";
import {
	cardDropZone,
	type PipelineSlot,
	placeStage,
	seamAt,
	swapStage,
	withoutStage,
} from "./stage-pipeline.ts";

const slots = (spec: string): PipelineSlot[] =>
	spec.split(" ").map((s) => ({ stageId: s.replace("+", ""), parallel: s.startsWith("+") }));

const spec = (list: readonly PipelineSlot[] | null): string | null =>
	list === null ? null : list.map((s) => `${s.parallel ? "+" : ""}${s.stageId}`).join(" ");

const slot = (list: readonly PipelineSlot[], id: string): PipelineSlot =>
	list.find((s) => s.stageId === id) ?? { stageId: id, parallel: false };

Deno.test("cardDropZone — edges insert, the middle joins, an unjoinable card splits in half", () => {
	const rect = { top: 100, height: 100 };
	assertEquals(cardDropZone(110, rect, true), "before");
	assertEquals(cardDropZone(150, rect, true), "join");
	assertEquals(cardDropZone(190, rect, true), "after");
	assertEquals(cardDropZone(140, rect, false), "before");
	assertEquals(cardDropZone(160, rect, false), "after");
});

Deno.test("seamAt — counts the slots whose midpoint the pointer has passed", () => {
	const rects = [{ top: 0, height: 40 }, { top: 50, height: 40 }, { top: 100, height: 40 }];
	assertEquals(seamAt(-5, rects), 0);
	assertEquals(seamAt(45, rects), 1);
	assertEquals(seamAt(500, rects), 3);
});

Deno.test("withoutStage — removing a band's opener promotes the next member", () => {
	assertEquals(spec(withoutStage(slots("a b +c d"), "b")), "a c d");
	assertEquals(spec(withoutStage(slots("a +b c"), "a")), "b c");
	assertEquals(spec(withoutStage(slots("a b +c"), "c")), "a b");
});

Deno.test("placeStage — a seam between bands makes the stage its own step", () => {
	const list = slots("a b +c d");
	assertEquals(spec(placeStage(list, slot(list, "d"), { kind: "seam", before: 0 })), "d a b +c");
	assertEquals(spec(placeStage(list, slot(list, "a"), { kind: "seam", before: 4 })), "b +c d a");
});

Deno.test("placeStage — a seam inside a band joins it rather than splitting it", () => {
	const list = slots("a b +c d");
	assertEquals(spec(placeStage(list, slot(list, "d"), { kind: "seam", before: 2 })), "a b +d +c");
});

Deno.test("placeStage — a moved continuation becomes its own step at a seam", () => {
	const list = slots("a +b c");
	assertEquals(spec(placeStage(list, slot(list, "b"), { kind: "seam", before: 3 })), "a c b");
});

Deno.test("placeStage — join lands at the end of the target's band", () => {
	const list = slots("a b +c d");
	assertEquals(
		spec(placeStage(list, slot(list, "d"), { kind: "join", stageId: "b" })),
		"a b +c +d",
	);
	assertEquals(
		spec(placeStage(list, slot(list, "a"), { kind: "join", stageId: "d" })),
		"b +c d +a",
	);
});

Deno.test("placeStage — a band's opener joining elsewhere leaves its partners together", () => {
	const list = slots("a +b c");
	assertEquals(spec(placeStage(list, slot(list, "a"), { kind: "join", stageId: "c" })), "b c +a");
});

Deno.test("placeStage — a drop that changes nothing returns null", () => {
	const list = slots("a b +c");
	assertEquals(placeStage(list, slot(list, "a"), { kind: "seam", before: 0 }), null);
	assertEquals(placeStage(list, slot(list, "a"), { kind: "seam", before: 1 }), null);
	assertEquals(placeStage(list, slot(list, "c"), { kind: "join", stageId: "b" }), null);
	assertEquals(placeStage(list, slot(list, "b"), { kind: "join", stageId: "b" }), null);
	assertEquals(placeStage(list, { stageId: "x", parallel: false }, { kind: "exclude" }), null);
});

Deno.test("placeStage — a new stage is inserted, and exclude removes with the band healed", () => {
	const list = slots("a +b");
	const x = { stageId: "x", parallel: false };
	assertEquals(spec(placeStage(list, x, { kind: "seam", before: 0 })), "x a +b");
	assertEquals(spec(placeStage(list, x, { kind: "seam", before: 2 })), "a +b x");
	assertEquals(spec(placeStage(list, x, { kind: "join", stageId: "a" })), "a +b +x");
	assertEquals(spec(placeStage(list, slot(list, "a"), { kind: "exclude" })), "b");
});

Deno.test("placeStage — the first slot never runs alongside a previous one", () => {
	const list = slots("a +b c");
	assertEquals(spec(placeStage(list, slot(list, "c"), { kind: "seam", before: 0 })), "c a +b");
});

Deno.test("swapStage — neighbours trade places and the bands keep their shape", () => {
	const list = slots("a +b c");
	assertEquals(spec(swapStage(list, "c", -1)), "a +c b");
	assertEquals(spec(swapStage(list, "a", 1)), "b +a c");
	assertEquals(swapStage(list, "a", -1), null);
	assertEquals(swapStage(list, "c", 1), null);
});
