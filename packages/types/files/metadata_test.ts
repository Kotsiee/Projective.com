import { assertEquals } from "@std/assert";
import {
	AssetMetadataSchema,
	BlurHashSchema,
	durationLabelOf,
	HexColorSchema,
	MediaMetadataSchema,
} from "./metadata.ts";

/**
 * The extracted-media contract, pinned.
 *
 * These schemas guard a boundary a type checker cannot: the values arrive from a browser that decoded
 * somebody's file, and every one of them is later interpolated into a style expression, a canvas, or a
 * clock a reader trusts. A malformed hash renders a broken placeholder; a hash from outside the base83
 * alphabet is not a short hash at all; and an unresampled envelope is a five-thousand-point array
 * arriving at a 512-bar visualizer. Each assertion below is the moment one of those is caught.
 */

const envelope = {
	version: 1 as const,
	source: "client" as const,
	extractedAt: "2026-08-31T09:00:00.000Z",
};

// #region The discriminated union

Deno.test("the union refuses a kind it does not carry", () => {
	const result = MediaMetadataSchema.safeParse({
		kind: "spreadsheet",
		width: 10,
		height: 10,
		aspectRatio: 1,
	});
	assertEquals(result.success, false);
});

Deno.test("the union refuses a payload whose kind names another member's shape", () => {
	// An image body labelled `audio` must not parse as audio-with-missing-fields: the discriminator is
	// what tells a consumer which branch to read, so a wrong one is a wrong render, not a soft failure.
	const result = MediaMetadataSchema.safeParse({
		kind: "audio",
		width: 800,
		height: 600,
		aspectRatio: 1.3333,
	});
	assertEquals(result.success, false);
});

Deno.test("generic is a real member — 'nothing further could be read' is a value", () => {
	assertEquals(MediaMetadataSchema.safeParse({ kind: "generic" }).success, true);
});

// #endregion

// #region BlurHash

Deno.test("BlurHash accepts the base83 alphabet", () => {
	assertEquals(BlurHashSchema.safeParse("LEHV6nWB2yk8pyo0adR*.7kCMdnj").success, true);
	assertEquals(BlurHashSchema.safeParse("#$%*+,-.:;=?@[]^_{|}~").success, true);
});

Deno.test("BlurHash rejects a character outside base83", () => {
	// The four ASCII printables base83 excludes. Each one arriving means the producer emitted
	// something that is not a hash, and the field must not accept it merely because it is a string.
	for (
		const bad of [
			"LEHV6nWB2yk8pyo0adR*.7kCMdn/",
			"LEHV6nWB2yk8pyo0adR*.7kCMdn\\",
			"LEHV6nWB2yk8pyo0adR*.7kCMdn'",
			'LEHV6nWB2yk8pyo0adR*.7kCMdn"',
		]
	) {
		assertEquals(BlurHashSchema.safeParse(bad).success, false, `accepted: ${bad}`);
	}
	assertEquals(BlurHashSchema.safeParse("LEHV6n WB2yk8").success, false);
});

Deno.test("BlurHash is bounded at both ends", () => {
	assertEquals(BlurHashSchema.safeParse("L").success, false);
	assertEquals(BlurHashSchema.safeParse("L".repeat(161)).success, false);
});

// #endregion

// #region Hex colour

Deno.test("hex colour accepts exactly one spelling", () => {
	assertEquals(HexColorSchema.safeParse("#0a1b2c").success, true);
});

Deno.test("hex colour rejects uppercase and 3-digit forms", () => {
	// These compare unequal to their canonical spellings, and the values are used as keys.
	assertEquals(HexColorSchema.safeParse("#0A1B2C").success, false);
	assertEquals(HexColorSchema.safeParse("#FFFFFF").success, false);
	assertEquals(HexColorSchema.safeParse("#fff").success, false);
	assertEquals(HexColorSchema.safeParse("0a1b2c").success, false);
	assertEquals(HexColorSchema.safeParse("#0a1b2c ").success, false);
});

// #endregion

// #region Audio peaks

Deno.test("peaks refuse an envelope longer than the visualizer's 512 bars", () => {
	const over = {
		...envelope,
		media: {
			kind: "audio",
			durationMs: 300_000,
			durationLabel: "5:00",
			peaks: new Array(513).fill(0.5),
			sampleRate: 48_000,
			channels: 1,
		},
	};
	assertEquals(AssetMetadataSchema.safeParse(over).success, false);
	over.media.peaks = new Array(512).fill(0.5);
	assertEquals(AssetMetadataSchema.safeParse(over).success, true);
});

Deno.test("peaks refuse an unnormalised value", () => {
	const result = AssetMetadataSchema.safeParse({
		...envelope,
		media: {
			kind: "audio",
			durationMs: 1_000,
			durationLabel: "0:01",
			peaks: [0, 0.5, 1.0001],
			sampleRate: null,
			channels: null,
		},
	});
	assertEquals(result.success, false);
});

// #endregion

// #region The envelope

Deno.test("the envelope round-trips every media kind", () => {
	const media = [
		{
			kind: "image",
			width: 1920,
			height: 1080,
			aspectRatio: 1.7778,
			blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
			colors: { average: "#3a4b5c", dominant: ["#3a4b5c", "#c0d1e2"] },
			animated: false,
			vector: false,
			hasAlpha: null,
		},
		{
			kind: "video",
			width: 1280,
			height: 720,
			aspectRatio: 1.7778,
			durationMs: 92_000,
			durationLabel: "1:32",
			blurhash: null,
			colors: null,
			posterAtMs: 500,
			posterDataUrl: null,
		},
		{
			kind: "audio",
			durationMs: 8_400,
			durationLabel: "0:08",
			peaks: [0, 0.25, 1],
			sampleRate: 44_100,
			channels: 2,
		},
		{
			kind: "document",
			pageCount: null,
			posterDataUrl: null,
			blurhash: null,
			width: null,
			height: null,
		},
		{ kind: "generic" },
	];

	for (const entry of media) {
		const parsed = AssetMetadataSchema.parse({ ...envelope, media: entry });
		assertEquals(parsed.media.kind, entry.kind);
		assertEquals(parsed.version, 1);
		assertEquals(parsed.source, "client");
		// Absent by construction rather than by omission — a row with no notes says "nothing to explain".
		assertEquals(parsed.notes, []);
	}
});

Deno.test("the version is a literal, so a stale row is identifiable rather than half-parsed", () => {
	const result = AssetMetadataSchema.safeParse({
		...envelope,
		version: 2,
		media: { kind: "generic" },
	});
	assertEquals(result.success, false);
});

Deno.test("notes carry the reason a field is null, bounded so a client cannot write an essay", () => {
	const parsed = AssetMetadataSchema.parse({
		...envelope,
		media: { kind: "generic" },
		notes: ["Canvas was tainted by a cross-origin source; poster capture refused."],
	});
	assertEquals(parsed.notes.length, 1);

	const tooMany = AssetMetadataSchema.safeParse({
		...envelope,
		media: { kind: "generic" },
		notes: new Array(9).fill("x"),
	});
	assertEquals(tooMany.success, false);
});

// #endregion

// #region Duration formatting

Deno.test("durationLabelOf prints the audio clock below an hour", () => {
	assertEquals(durationLabelOf(0), "0:00");
	assertEquals(durationLabelOf(1_000), "0:01");
	assertEquals(durationLabelOf(65_000), "1:05");
	assertEquals(durationLabelOf(599_000), "9:59");
	assertEquals(durationLabelOf(3_599_000), "59:59");
});

Deno.test("durationLabelOf grows a third field only where audio never reaches", () => {
	// A two-hour video reading "120:00" is not a shorter label, it is a wrong-looking one.
	assertEquals(durationLabelOf(3_600_000), "1:00:00");
	assertEquals(durationLabelOf(7_384_000), "2:03:04");
});

Deno.test("durationLabelOf clamps an unreadable duration to zero rather than printing nonsense", () => {
	assertEquals(durationLabelOf(-1), "0:00");
	assertEquals(durationLabelOf(Number.NaN), "0:00");
	assertEquals(durationLabelOf(Number.POSITIVE_INFINITY), "0:00");
});

Deno.test("every durationLabelOf output fits the schema's 12-character bound", () => {
	for (const ms of [0, 999, 59_999, 3_599_999, 3_600_000, 86_399_000, 359_999_000]) {
		const label = durationLabelOf(ms);
		assertEquals(label.length <= 12, true, `too long: ${label}`);
	}
});

// #endregion
