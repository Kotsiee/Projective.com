import { assert, assertEquals } from "@std/assert";
import { type AssetItem, INITIAL_CROP, messageAttachmentFacets } from "@projective/types/files";
import {
	assignSlots,
	candidateFromAsset,
	type CropCandidate,
	cycleIndex,
	mediaAcceptAttr,
	mediaKinds,
	type PickItem,
	toggleSelection,
} from "./media-pick.ts";

function asset(overrides: Partial<AssetItem>): AssetItem {
	return {
		id: "a1",
		kind: "image",
		category: "Image",
		name: "portrait.jpg",
		ext: "jpg",
		url: "/api/files/object/a1",
		thumbnailUrl: "/api/files/object/a1?tier=sm",
		sizeBytes: 1000,
		sizeLabel: "1 KB",
		width: 1600,
		height: 1200,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: "2026-10-09T00:00:00Z",
		timeLabel: "",
		dayLabel: "",
		dateLabel: "",
		starred: false,
		...messageAttachmentFacets("u1", { visibility: "private" }),
		...overrides,
	};
}

Deno.test("candidateFromAsset: an uploaded still frames from its upright lg tier", () => {
	const c = candidateFromAsset(asset({}), false);
	assert(!("refusal" in c));
	assertEquals(c.src, "/api/files/object/a1?tier=lg");
	assertEquals([c.width, c.height], [1600, 1200]);
});

Deno.test("candidateFromAsset: a video only where the target takes one", () => {
	const video = asset({ kind: "video", category: "Video", url: "/api/files/object/a1" });
	assert("refusal" in candidateFromAsset(video, false));
	const c = candidateFromAsset(video, true);
	assert(!("refusal" in c));
	assertEquals(c.src, "/api/files/object/a1");
});

Deno.test("candidateFromAsset: refuses what the server cut would refuse", () => {
	assert("refusal" in candidateFromAsset(asset({ kind: "pdf", category: "Document" }), true));
	assert("refusal" in candidateFromAsset(asset({ status: "scanning" }), false));
	assert("refusal" in candidateFromAsset(asset({ width: null }), false));
	assert("refusal" in candidateFromAsset(asset({ source: "google_drive" }), false));
});

Deno.test("mediaKinds + mediaAcceptAttr follow the target's video rule", () => {
	assertEquals(mediaKinds({ allowVideo: false }), ["image"]);
	assertEquals(mediaKinds({ allowVideo: true }), ["image", "video"]);
	assertEquals(mediaAcceptAttr({ allowVideo: false }), "image/*");
});

function cand(id: string, kind: "image" | "video" = "image"): CropCandidate {
	return {
		id,
		name: id,
		kind,
		src: id,
		width: 10,
		height: 10,
		poster: null,
		origin: { kind: "library" },
	};
}

function picked(...ids: string[]): PickItem[] {
	return ids.map((id) => ({ candidate: cand(id), crop: INITIAL_CROP, alt: "" }));
}

Deno.test("toggleSelection: adds up to the cap, then refuses", () => {
	const two = toggleSelection(picked("a"), cand("b"), 2);
	assert("items" in two);
	assertEquals(two.items.map((i) => i.candidate.id), ["a", "b"]);
	assert("refusal" in toggleSelection(two.items, cand("c"), 2));
});

Deno.test("toggleSelection: a chosen source toggles off, alone or among several", () => {
	const one = toggleSelection(picked("a"), cand("a"), 3);
	assert("items" in one);
	assertEquals(one.items, []);
	const many = toggleSelection(picked("a", "b", "c"), cand("b"), 3);
	assert("items" in many);
	assertEquals(many.items.map((i) => i.candidate.id), ["a", "c"]);
});

Deno.test("toggleSelection: a single slot replaces rather than refuses", () => {
	const r = toggleSelection(picked("a"), cand("b"), 1);
	assert("items" in r);
	assertEquals(r.items.map((i) => i.candidate.id), ["b"]);
});

Deno.test("cycleIndex: wraps both ways", () => {
	assertEquals(cycleIndex(2, 3, 1), 0);
	assertEquals(cycleIndex(0, 3, -1), 2);
	assertEquals(cycleIndex(1, 3, 1), 2);
	assertEquals(cycleIndex(0, 0, 1), 0);
});

Deno.test("assignSlots: in order, but slot 1 always gets a still", () => {
	const items = [{ candidate: cand("v", "video") }, { candidate: cand("p") }];
	const r = assignSlots(items, [1, 4]);
	assert("slots" in r);
	assertEquals(r.slots, [4, 1]);
	const plain = assignSlots(items, [3, 5]);
	assert("slots" in plain);
	assertEquals(plain.slots, [3, 5]);
	assert("refusal" in assignSlots([{ candidate: cand("v", "video") }], [1, 2]));
});
