import { assert, assertEquals, assertFalse } from "@std/assert";
import type { AssetItem, AssetListParams } from "@projective/types/files";
import { assetMatches, nameMatches, needleOf } from "./list-filter.ts";

function asset(over: Partial<AssetItem> = {}): AssetItem {
	return {
		id: "a1",
		kind: "image",
		category: "Image",
		name: "Brand poster.png",
		ext: "png",
		url: "#",
		thumbnailUrl: null,
		sizeBytes: 10,
		sizeLabel: "10 B",
		width: null,
		height: null,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		timeLabel: "12:00 AM",
		dayLabel: "Oct 1",
		dateLabel: "Oct 1 · 12:00 AM",
		starred: false,
		source: "supabase",
		status: "uploaded",
		visibility: "private",
		ownerType: "user",
		ownerId: "u1",
		folderId: null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: null,
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: true,
		...over,
	};
}

const HUB: AssetListParams = { scope: "hub" };

Deno.test("needleOf: trims and lower-cases, empty when absent", () => {
	assertEquals(needleOf({ query: "  Poster " }), "poster");
	assertEquals(needleOf({}), "");
});

Deno.test("nameMatches: any name may carry the needle; no needle matches everything", () => {
	assert(nameMatches("", null));
	assert(nameMatches("final", "Brand poster.png", "poster-FINAL-v3.png"));
	assertFalse(nameMatches("final", "Brand poster.png", null));
});

Deno.test("assetMatches: the query reaches the uploaded name as well as the display name", () => {
	const renamed = asset({ name: "Brand poster.png" });
	assert(assetMatches(renamed, { ...HUB, query: "brand" }));
	assert(assetMatches(renamed, { ...HUB, query: "IMG_0042" }, "IMG_0042.png"));
	assertFalse(assetMatches(renamed, { ...HUB, query: "IMG_0042" }));
});

Deno.test("assetMatches: categories, sources and visibility narrow independently", () => {
	const doc = asset({ kind: "doc", category: "Spreadsheet", visibility: "public" });
	assert(assetMatches(doc, { ...HUB, categories: ["Spreadsheet", "Document"] }));
	assertFalse(assetMatches(doc, { ...HUB, categories: ["Document"] }));
	assertFalse(assetMatches(doc, { ...HUB, sources: ["link"] }));
	assert(assetMatches(doc, { ...HUB, visibility: ["public"] }));
	assertFalse(assetMatches(doc, { ...HUB, visibility: ["private", "link"] }));
	assert(assetMatches(doc, { ...HUB, categories: [], sources: [], visibility: [] }));
});
