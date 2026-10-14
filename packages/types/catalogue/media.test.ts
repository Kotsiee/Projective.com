import { assertEquals } from "@std/assert";
import {
	ApplyListingMediaSchema,
	coverOf,
	type ListingMediaSlot,
	ListingMediaSlotsSchema,
	ReorderListingMediaSchema,
	reorderSlots,
	SaveListingShowcaseSchema,
	SHOWCASE_SLOTS,
	withoutSlot,
} from "./media.ts";

function slot(position: number, kind: "image" | "video" = "image"): ListingMediaSlot {
	return {
		position,
		kind,
		fileId: crypto.randomUUID(),
		thumb: `/t/${position}.webp`,
		src: `/s/${position}`,
		alt: "",
	};
}

const ok = (value: unknown) => ListingMediaSlotsSchema.safeParse(value).success;

Deno.test("a showcase holds at most six slots", () => {
	assertEquals(SHOWCASE_SLOTS, 6);
	assertEquals(ok([1, 2, 3, 4, 5, 6].map((p) => slot(p))), true);
	assertEquals(ok([1, 2, 3, 4, 5, 6, 6].map((p) => slot(p))), false);
	assertEquals(ok([slot(7)]), false);
	assertEquals(ok([slot(0)]), false);
});

Deno.test("each position holds one item", () => {
	assertEquals(ok([slot(2), slot(2)]), false);
	assertEquals(ok([slot(2), slot(4)]), true);
});

Deno.test("slot 1 must be an image; video is fine elsewhere", () => {
	assertEquals(ok([slot(1, "video")]), false);
	assertEquals(ok([slot(1), slot(2, "video"), slot(6, "video")]), true);
});

Deno.test("a slot needs a file id, never a bare URL", () => {
	assertEquals(ok([{ ...slot(1), fileId: "https://example.com/a.png" }]), false);
});

Deno.test("coverOf returns the slot-1 still or null", () => {
	const cover = slot(1);
	assertEquals(coverOf([slot(3), cover]), cover);
	assertEquals(coverOf([slot(2), slot(3)]), null);
	assertEquals(coverOf([]), null);
});

Deno.test("ApplyListingMedia takes one to six choices on distinct positions", () => {
	const choice = (position: number) => ({ sourceAssetId: crypto.randomUUID(), position });
	const parse = (choices: unknown[]) =>
		ApplyListingMediaSchema.safeParse({ listingId: "svc-23456789ab", choices }).success;
	assertEquals(parse([choice(1)]), true);
	assertEquals(parse([]), false);
	assertEquals(parse([choice(1), choice(1)]), false);
	assertEquals(parse([1, 2, 3, 4, 5, 6, 1].map(choice)), false);
	assertEquals(
		ApplyListingMediaSchema.safeParse({
			listingId: "svc-23456789ab",
			choices: [{ ...choice(2), alt: "x".repeat(201) }],
		}).success,
		false,
	);
});

Deno.test("ReorderListingMedia refuses a repeated position", () => {
	const parse = (order: number[]) =>
		ReorderListingMediaSchema.safeParse({ listingId: "prd-23456789ab", order }).success;
	assertEquals(parse([2, 1, 3]), true);
	assertEquals(parse([2, 2]), false);
	assertEquals(parse([]), false);
	assertEquals(parse([7]), false);
});

Deno.test("reorderSlots keeps the filled positions and moves the slots", () => {
	const [a, b, d] = [slot(1), slot(2), slot(4)];
	const result = reorderSlots([a, b, d], [2, 1, 4]);
	assertEquals(result.ok, true);
	if (result.ok) {
		assertEquals(result.slots.map((s) => [s.fileId, s.position]), [
			[b.fileId, 1],
			[a.fileId, 2],
			[d.fileId, 4],
		]);
	}
});

Deno.test("reorderSlots refuses a non-permutation and a video cover", () => {
	const slots = [slot(1), slot(2, "video")];
	assertEquals(reorderSlots(slots, [1]).ok, false);
	assertEquals(reorderSlots(slots, [1, 3]).ok, false);
	assertEquals(reorderSlots(slots, [2, 1]).ok, false);
});

Deno.test("SaveListingShowcase refuses a repeated position or file", () => {
	const fileId = crypto.randomUUID();
	const parse = (slots: unknown[]) =>
		SaveListingShowcaseSchema.safeParse({ listingId: "svc-23456789ab", slots }).success;
	assertEquals(parse([]), true);
	assertEquals(parse([{ position: 1, fileId, alt: "Cover" }]), true);
	assertEquals(
		parse([{ position: 1, fileId, alt: "" }, {
			position: 1,
			fileId: crypto.randomUUID(),
			alt: "",
		}]),
		false,
	);
	assertEquals(parse([{ position: 1, fileId, alt: "" }, { position: 2, fileId, alt: "" }]), false);
	assertEquals(parse([{ position: 2, fileId, alt: "x".repeat(201) }]), false);
});

Deno.test("withoutSlot empties a position and leaves the rest where they are", () => {
	const [a, b, c] = [slot(1), slot(2), slot(4)];
	assertEquals(withoutSlot([a, b, c], 2).map((s) => [s.fileId, s.position]), [
		[a.fileId, 1],
		[c.fileId, 4],
	]);
});

Deno.test("withoutSlot promotes the first remaining still into an emptied cover", () => {
	const [a, v, b, c] = [slot(1), slot(2, "video"), slot(3), slot(5)];
	assertEquals(withoutSlot([a, v, b, c], 1).map((s) => [s.fileId, s.position]), [
		[b.fileId, 1],
		[v.fileId, 2],
		[c.fileId, 5],
	]);
});

Deno.test("withoutSlot leaves a showcase of only videos without a cover", () => {
	const [a, v] = [slot(1), slot(3, "video")];
	const next = withoutSlot([a, v], 1);
	assertEquals(next.map((s) => s.position), [3]);
	assertEquals(coverOf(next), null);
});
