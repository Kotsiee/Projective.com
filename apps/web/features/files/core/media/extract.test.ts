import { assert, assertEquals } from "@std/assert";
import { AssetMetadataSchema } from "../../types/file-types.ts";
import { awaitExtraction, extractMetadata } from "./extract.ts";

/**
 * The extraction entry point, exercised where it can actually run.
 *
 * `deno test` is not a browser: there is no `document`, no `AudioContext` and no usable 2D canvas, so
 * the paths that decode a photograph, seek a video or measure a waveform are unreachable here and are
 * NOT claimed to be tested. What is reachable is the half that matters most for correctness — the
 * dispatch, the SVG reader, the PDF page-count heuristic, the note vocabulary, and the promise that
 * none of it can throw or produce a row the SSOT would reject. Those are also the paths where a
 * regression would be silent in a browser, because a degraded row still uploads.
 *
 * That absence is itself the test in several cases below: an environment with no decoder is exactly
 * what a person on an old browser has, and the required behaviour is a `generic` row carrying a
 * sentence, never a rejected upload.
 */

// #region Fixtures
/** A `File` with the given bytes, name and MIME type. */
function fileOf(name: string, type: string, bytes: Uint8Array<ArrayBuffer> | string): File {
	const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	return new File([data], name, { type });
}

/** An uncompressed PDF holding one page tree and three page objects, spelled three ways. */
const PLAIN_PDF = [
	"%PDF-1.4",
	"1 0 obj<</Type /Pages /Count 3>>endobj",
	"2 0 obj<</Type /Page>>endobj",
	"3 0 obj<</Type/Page>>endobj",
	"4 0 obj<</Type  /Page>>endobj",
	"%%EOF",
].join("\n");
// #endregion

// #region The envelope
Deno.test("every extraction produces a row the SSOT accepts", async () => {
	const files = [
		fileOf("bundle.zip", "application/zip", new Uint8Array([1, 2, 3])),
		fileOf("logo.svg", "image/svg+xml", '<svg width="120" height="60"></svg>'),
		fileOf("contract.pdf", "application/pdf", PLAIN_PDF),
		fileOf("broken.png", "image/png", new Uint8Array([1, 2, 3])),
	];
	await Promise.all(files.map(async (file) => {
		const meta = await extractMetadata(file);
		assert(AssetMetadataSchema.safeParse(meta).success, `rejected for ${file.name}`);
		assertEquals(meta.version, 1);
		assertEquals(meta.source, "client");
		assert(
			Number.isFinite(Date.parse(meta.extractedAt)),
			`unparseable instant for ${file.name}: ${meta.extractedAt}`,
		);
		assert(meta.notes.length <= 8);
		for (const note of meta.notes) assert(note.length <= 200);
	}));
});
// #endregion

// #region Dispatch
Deno.test("a file with nothing readable inside it is generic, and says nothing about it", () => {
	// An archive's kind is known and there is nothing a browser can read without unpacking it. That
	// is not a failure, so it earns no note — a sentence here would train a reader to ignore them.
	return extractMetadata(fileOf("bundle.zip", "application/zip", new Uint8Array([1, 2, 3])))
		.then((meta) => {
			assertEquals(meta.media.kind, "generic");
			assertEquals(meta.notes, []);
		});
});

Deno.test("a decoder that refuses degrades to generic with a reason, never a throw", async () => {
	// The bytes are deliberately not a PNG. In a browser a real one decodes; the behaviour under test
	// is what happens when it does not, which is the case an upload must survive.
	const meta = await extractMetadata(fileOf("broken.png", "image/png", new Uint8Array([1, 2, 3])));
	assertEquals(meta.media.kind, "generic");
	assertEquals(meta.notes.length, 1);
	assert(meta.notes[0].includes("could not decode"), meta.notes[0]);
});

Deno.test("audio and video degrade with their own reasons rather than a shared one", async () => {
	const audio = await extractMetadata(fileOf("memo.mp3", "audio/mpeg", new Uint8Array([0xff])));
	const video = await extractMetadata(fileOf("clip.mp4", "video/mp4", new Uint8Array([0])));
	assertEquals(audio.media.kind, "generic");
	assertEquals(video.media.kind, "generic");
	// A null waveform and a null poster are different facts; a shared sentence would make them one.
	assert(audio.notes[0] !== video.notes[0], "audio and video share a note");
});
// #endregion

// #region SVG
Deno.test("an SVG's size is read from its markup, never by rasterising it", async () => {
	const meta = await extractMetadata(
		fileOf("logo.svg", "image/svg+xml", '<svg width="120" height="60"><rect/></svg>'),
	);
	assertEquals(meta.media.kind, "image");
	if (meta.media.kind !== "image") return;
	assertEquals(meta.media.width, 120);
	assertEquals(meta.media.height, 60);
	assertEquals(meta.media.aspectRatio, 2);
	assertEquals(meta.media.vector, true);
	// No pixels were read, so there is nothing to hash or to sample — stated, not invented.
	assertEquals(meta.media.blurhash, null);
	assertEquals(meta.media.colors, null);
});

Deno.test("a percentage-sized SVG falls back to its viewBox", async () => {
	const meta = await extractMetadata(
		fileOf("flexible.svg", "image/svg+xml", '<svg width="100%" viewBox="0 0 32 16"></svg>'),
	);
	assertEquals(meta.media.kind, "image");
	if (meta.media.kind !== "image") return;
	assertEquals(meta.media.width, 32);
	assertEquals(meta.media.height, 16);
});

Deno.test("an SVG with no intrinsic size reports none rather than the browser's 300x150", async () => {
	const meta = await extractMetadata(fileOf("bare.svg", "image/svg+xml", "<svg></svg>"));
	assertEquals(meta.media.kind, "generic");
	assert(meta.notes[0].includes("no intrinsic size"), meta.notes[0]);
});
// #endregion

// #region PDF
Deno.test("the page heuristic counts page objects and not the page tree", async () => {
	// `/Type /Pages` is the tree node — one per document — and counting it would report every PDF as
	// having one page more than it does.
	const meta = await extractMetadata(fileOf("contract.pdf", "application/pdf", PLAIN_PDF));
	assertEquals(meta.media.kind, "document");
	if (meta.media.kind !== "document") return;
	assertEquals(meta.media.pageCount, 3);
	assertEquals(meta.media.posterDataUrl, null);
	assert(meta.notes.some((note) => note.includes("No PDF reader")), meta.notes.join(" | "));
});

Deno.test("a PDF whose pages are compressed reports no count, not a count of zero", async () => {
	const meta = await extractMetadata(
		fileOf("packed.pdf", "application/pdf", "%PDF-1.7\n1 0 obj<</Type/ObjStm>>stream\nx\n%%EOF"),
	);
	assertEquals(meta.media.kind, "document");
	if (meta.media.kind !== "document") return;
	assertEquals(meta.media.pageCount, null);
	assert(meta.notes.some((note) => note.includes("compressed")), meta.notes.join(" | "));
});

Deno.test("a document that is not a PDF is still a document, with everything unread", async () => {
	const meta = await extractMetadata(
		fileOf("brief.docx", "application/msword", new Uint8Array([0x50, 0x4b, 3, 4])),
	);
	assertEquals(meta.media.kind, "document");
	if (meta.media.kind !== "document") return;
	assertEquals(meta.media.pageCount, null);
	assertEquals(meta.media.width, null);
});
// #endregion

// #region Awaiting
Deno.test("no extraction means no metadata, which is not the same as an empty one", async () => {
	// `UploadCompleteSchema.metadata` is both optional and nullable precisely so "never tried" and
	// "tried and got nothing" stay distinguishable on the wire.
	assertEquals(await awaitExtraction(null), null);
	assertEquals(await awaitExtraction(undefined), null);
});

Deno.test("an extraction that resolves in time is handed straight through", async () => {
	const pending = extractMetadata(
		fileOf("logo.svg", "image/svg+xml", '<svg width="8" height="4"/>'),
	);
	const settled = await awaitExtraction(pending, 5000);
	assertEquals(settled?.media.kind, "image");
});

Deno.test("an extraction that overruns its budget falls back to generic with a reason", async () => {
	const never = new Promise<never>(() => {});
	const settled = await awaitExtraction(never, 10);
	assertEquals(settled?.media.kind, "generic");
	assert(settled?.notes[0].includes("too long"), settled?.notes[0]);
});

Deno.test("a rejected extraction is absorbed rather than left unhandled", async () => {
	const settled = await awaitExtraction(Promise.reject(new Error("boom")), 1000);
	assertEquals(settled?.media.kind, "generic");
	assert(settled?.notes[0].includes("could not be read"), settled?.notes[0]);
	assert(AssetMetadataSchema.safeParse(settled).success);
});
// #endregion
