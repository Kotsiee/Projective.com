import { assert, assertEquals, assertRejects } from "@std/assert";
import { type AssetMetadata, sniffBytes } from "@projective/types/files";
import { MediaPipeline, MediaRejectedError } from "../media/pipeline.ts";
import { acceptUpload, MARKUP_REFUSED, PROGRAM_REFUSED } from "./upload-acceptance.ts";

const text = (s: string) => new TextEncoder().encode(s);
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function clientMeta(media: AssetMetadata["media"]): AssetMetadata {
	return { version: 1, source: "client", extractedAt: "2026-10-30T00:00:00Z", media, notes: [] };
}
const CLIENT_IMAGE = clientMeta({
	kind: "image",
	width: 10,
	height: 10,
	aspectRatio: 1,
	blurhash: null,
	colors: null,
	animated: false,
	vector: false,
	hasAlpha: false,
});

Deno.test("acceptUpload: a program is refused as hostile", () => {
	assertEquals(acceptUpload(sniffBytes(text("MZ")), null), {
		ok: false,
		hostile: true,
		message: PROGRAM_REFUSED,
	});
});

Deno.test("acceptUpload: SVG, HTML and XML are refused by name", () => {
	for (const doc of ["<svg xmlns='x'>", "<!doctype html><p>", '<?xml version="1.0"?><x/>']) {
		assertEquals(acceptUpload(sniffBytes(text(doc)), null), {
			ok: false,
			hostile: false,
			message: MARKUP_REFUSED,
		});
	}
});

Deno.test("acceptUpload: a sniff miss is stored as octet-stream and loses a client media envelope", () => {
	const verdict = acceptUpload(sniffBytes(text("just some notes")), CLIENT_IMAGE);
	assert(verdict.ok);
	assertEquals(verdict.mime, "application/octet-stream");
	assertEquals(verdict.decode, false);
	assertEquals(verdict.metadata, undefined);
	const doc = clientMeta({ kind: "generic" } as AssetMetadata["media"]);
	assertEquals(acceptUpload(null, doc), {
		ok: true,
		mime: "application/octet-stream",
		decode: false,
		metadata: doc,
	});
});

Deno.test("acceptUpload: a sniffed still is stored under its real type and must decode", () => {
	const verdict = acceptUpload(sniffBytes(new Uint8Array(PNG_HEAD)), null);
	assert(verdict.ok);
	assertEquals(verdict.mime, "image/png");
	assertEquals(verdict.decode, true);
});

Deno.test({
	name:
		"upload: bytes that sniff as a picture but will not decode are a pipeline rejection (refused, not stored)",
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		const fake = new Uint8Array([...PNG_HEAD, ...text("not really a png at all")]);
		assertEquals(sniffBytes(fake)?.mime, "image/png");
		await assertRejects(
			() => MediaPipeline.run({ kind: "ingest", bytes: fake, mime: "image/png" }),
			MediaRejectedError,
		);
		MediaPipeline.shutdown();
	},
});
