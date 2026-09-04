import { assert, assertEquals } from "@std/assert";
import type { AssetItem, AssetMetadata, MediaMetadata } from "@projective/types/files";
import { AssetItemSchema } from "@projective/types/files";
import { applyMediaFacts, mediaFactsFrom } from "./media-facts.ts";

/**
 * The metadata → asset-row projection, pinned on the two rules that are silent when they break.
 *
 * A wrong dimension does not crash anything: the grid draws a picture in a box of the wrong shape and
 * every test that only checks "a number came back" passes. So the assertions below are about the
 * DIRECTION of the merge — that a measurement replaces a placeholder and an unread field replaces
 * nothing — and about the one bound where two schemas disagree by two orders of magnitude.
 */

// #region Fixtures
/** An extraction envelope wrapping one media projection. */
function envelope(media: MediaMetadata, notes: string[] = []): AssetMetadata {
	return {
		version: 1,
		source: "client",
		extractedAt: "2026-08-31T12:00:00.000Z",
		media,
		notes,
	};
}

/**
 * An asset row carrying the placeholder figures the stub mints before anyone has read the bytes.
 *
 * Deliberately populated rather than null: the case worth testing is a measurement arriving over a
 * stand-in, which is the only case where the merge direction is observable.
 */
function row(overrides: Partial<AssetItem> = {}): AssetItem {
	return {
		id: "asset-1",
		kind: "image",
		category: "Image",
		name: "shot.jpg",
		ext: "jpg",
		url: "https://example.test/stand-in.jpg",
		thumbnailUrl: "https://example.test/stand-in.jpg",
		sizeBytes: 1024,
		sizeLabel: "1 KB",
		width: 900,
		height: 600,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: "2026-08-31T12:00:00.000Z",
		timeLabel: "12:00 PM",
		dayLabel: "Today",
		dateLabel: "Aug 31 · 12:00 PM",
		starred: false,
		source: "supabase",
		status: "uploaded",
		visibility: "private",
		ownerType: "user",
		ownerId: "user-1",
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
		...overrides,
	};
}

/** A `data:` URL of a stated length, so a bound can be exercised on either side of itself. */
function poster(length: number): string {
	const prefix = "data:image/jpeg;base64,";
	return prefix + "A".repeat(Math.max(0, length - prefix.length));
}
// #endregion

// #region The merge direction
Deno.test("a measured dimension replaces the placeholder the row was minted with", () => {
	const merged = applyMediaFacts(
		row({ width: 900, height: 600 }),
		envelope({
			kind: "image",
			width: 1600,
			height: 900,
			aspectRatio: 1.7778,
			blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
			colors: null,
			animated: false,
			vector: false,
			hasAlpha: false,
		}),
	);
	assertEquals(merged.width, 1600);
	assertEquals(merged.height, 900);
});

Deno.test("a field the extraction could not read leaves the row's own value alone", () => {
	// The failure this prevents: a browser that cannot decode reports nulls, and a merge that wrote
	// them would turn a degraded read into data loss. "Not read" and "not there" are different facts
	// and `metadata.notes` is where the first one is explained.
	const merged = applyMediaFacts(
		row({ width: 900, height: 600 }),
		envelope({ kind: "generic" }, ["This browser could not decode the image."]),
	);
	assertEquals(merged.width, 900);
	assertEquals(merged.height, 600);
	assertEquals(merged.thumbnailUrl, "https://example.test/stand-in.jpg");
});

Deno.test("no envelope at all leaves every measured field alone", () => {
	const before = row();
	assertEquals(applyMediaFacts(before, undefined), before);

	// A `null` envelope moves no MEASUREMENT either — but it is not the same as no envelope, and the
	// row records the difference. Absent means nobody looked; `null` means a client reached for the
	// bytes and could not read them, which is what stops the pipeline retrying a file that will never
	// decode. Folding the two together would make the schema's three states two, and the third is the
	// one carrying the reason.
	const tried = applyMediaFacts(before, null);
	for (const key of ["width", "height", "durationLabel", "thumbnailUrl"] as const) {
		assertEquals(tried[key], before[key], `${key} moved on a null envelope`);
	}
	assertEquals(tried.metadata, null);
	assertEquals(before.metadata, undefined);
});

Deno.test("audio answers a duration and deliberately answers no dimensions", () => {
	// A waveform is not a picture size. An audio row that reported one would give the grid an aspect
	// box for something with no picture in it.
	const facts = mediaFactsFrom(envelope({
		kind: "audio",
		durationMs: 42_000,
		durationLabel: "0:42",
		peaks: [0, 0.5, 1],
		sampleRate: 44100,
		channels: 2,
	}));
	assertEquals(facts.durationLabel, "0:42");
	assertEquals(facts.width, null);
	assertEquals(facts.height, null);
	assertEquals(facts.thumbnailUrl, null);
});
// #endregion

// #region The poster bound
Deno.test("a poster too long for the thumbnail column is not written into it", () => {
	// `posterDataUrl` is bounded at 400,000 characters and `thumbnailUrl` at 2,000. A real 640px JPEG
	// frame sits far above the second bound, and writing one anyway produces a row that fails its own
	// schema at whichever boundary re-parses it.
	const large = poster(50_000);
	const merged = applyMediaFacts(
		row({ kind: "video", thumbnailUrl: null }),
		envelope({
			kind: "video",
			width: 1920,
			height: 1080,
			aspectRatio: 1.7778,
			durationMs: 12_000,
			durationLabel: "0:12",
			blurhash: null,
			colors: null,
			posterAtMs: 500,
			posterDataUrl: large,
		}),
	);
	assertEquals(merged.thumbnailUrl, null);
	assertEquals(merged.durationLabel, "0:12");
	assert(AssetItemSchema.safeParse(merged).success, "the merged row must satisfy its own schema");
});

Deno.test("a poster that genuinely fits the column is adopted as the thumbnail", () => {
	const small = poster(1500);
	const merged = applyMediaFacts(
		row({ kind: "video", thumbnailUrl: null }),
		envelope({
			kind: "video",
			width: 16,
			height: 16,
			aspectRatio: 1,
			durationMs: 1000,
			durationLabel: "0:01",
			blurhash: null,
			colors: null,
			posterAtMs: 500,
			posterDataUrl: small,
		}),
	);
	assertEquals(merged.thumbnailUrl, small);
	assert(AssetItemSchema.safeParse(merged).success);
});

Deno.test("the bound this module restates is the one the SSOT actually enforces", () => {
	// Zod does not expose a schema's `max` as a readable number, so the constant is restated in
	// `media-facts.ts`. This is what stops the two drifting: a value one character over the restated
	// bound must be one the schema also refuses.
	assert(AssetItemSchema.safeParse(row({ thumbnailUrl: poster(2000) })).success);
	assert(!AssetItemSchema.safeParse(row({ thumbnailUrl: poster(2001) })).success);
});
// #endregion

// #region Documents
Deno.test("a document with nothing rendered answers nothing, and keeps its row intact", () => {
	const merged = applyMediaFacts(
		row({ kind: "pdf", width: null, height: null, thumbnailUrl: null }),
		envelope({
			kind: "document",
			pageCount: 12,
			posterDataUrl: null,
			blurhash: null,
			width: null,
			height: null,
		}, ["No PDF reader is loaded, so the first page was not turned into a preview."]),
	);
	assertEquals(merged.width, null);
	assertEquals(merged.thumbnailUrl, null);
	assert(AssetItemSchema.safeParse(merged).success);
});
// #endregion
