import { assert, assertEquals, assertRejects } from "@std/assert";
import { type AssetMetadata, sniffBytes } from "@projective/types/files";
import { MediaPipeline, MediaRejectedError } from "../media/pipeline.ts";
import { acceptUpload, MARKUP_MISMATCH, PROGRAM_REFUSED } from "./upload-acceptance.ts";

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
	assertEquals(acceptUpload(sniffBytes(text("MZ")), null, "setup.exe"), {
		ok: false,
		hostile: true,
		message: PROGRAM_REFUSED,
	});
});

Deno.test("acceptUpload: a program is refused whatever it is named", () => {
	const verdict = acceptUpload(sniffBytes(text("MZ")), null, "diagram.svg");
	assertEquals(verdict.ok, false);
});

Deno.test("acceptUpload: an SVG is sent to the sanitiser and filed as a picture", () => {
	const verdict = acceptUpload(sniffBytes(text("<svg xmlns='x'>")), CLIENT_IMAGE, "logo.svg");
	assert(verdict.ok);
	assertEquals([verdict.mime, verdict.sanitize, verdict.inert], ["image/svg+xml", true, false]);
	assertEquals(verdict.metadata, CLIENT_IMAGE);
});

Deno.test("acceptUpload: a .svg always meets the sanitiser, even when the sniff missed it", () => {
	for (const head of ["<!-- a long comment pushes the svg tag past the sniff -->", "plain text"]) {
		const verdict = acceptUpload(sniffBytes(text(head)), null, "logo.SVG");
		assert(verdict.ok && verdict.sanitize, head);
	}
});

Deno.test("acceptUpload: HTML and XML are kept as inert text under a name that says so", () => {
	const cases: [string, string, string][] = [
		["<!doctype html><p>", "index.html", "text/html"],
		["<html><body>", "page.htm", "text/html"],
		['<?xml version="1.0"?><x/>', "feed.xml", "application/xml"],
		['<?xml version="1.0"?><x/>', "transform.xsl", "application/xml"],
		["<script setup>", "App.vue", "text/html"],
		["<svg xmlns='x'>", "notes.txt", "application/xml"],
		["<html>", "snippet.md", "text/html"],
	];
	for (const [doc, name, mime] of cases) {
		const verdict = acceptUpload(sniffBytes(text(doc)), null, name);
		assert(verdict.ok, name);
		assertEquals([verdict.mime, verdict.inert, verdict.sanitize], [mime, true, false], name);
	}
});

Deno.test("acceptUpload: JavaScript has no magic number and stays plain bytes", () => {
	const verdict = acceptUpload(sniffBytes(text("alert(1);")), null, "app.js");
	assert(verdict.ok);
	assertEquals([verdict.mime, verdict.sanitize], ["application/octet-stream", false]);
});

Deno.test("acceptUpload: markup under a binary format's name is a polyglot, and refused", () => {
	for (const name of ["photo.png", "report.pdf", "clip.mp4", "deck.pptx", "bundle.zip", "noext"]) {
		assertEquals(acceptUpload(sniffBytes(text("<!doctype html><p>")), null, name), {
			ok: false,
			hostile: false,
			message: MARKUP_MISMATCH,
		});
	}
});

Deno.test("acceptUpload: inert markup keeps no claim to be a picture", () => {
	const verdict = acceptUpload(sniffBytes(text("<!doctype html>")), CLIENT_IMAGE, "index.html");
	assert(verdict.ok);
	assertEquals(verdict.metadata, undefined);
});

Deno.test("acceptUpload: a sniff miss is stored as octet-stream and loses a client media envelope", () => {
	const verdict = acceptUpload(sniffBytes(text("just some notes")), CLIENT_IMAGE, "notes.txt");
	assert(verdict.ok);
	assertEquals(verdict.mime, "application/octet-stream");
	assertEquals(verdict.decode, false);
	assertEquals(verdict.metadata, undefined);
	const doc = clientMeta({ kind: "generic" } as AssetMetadata["media"]);
	assertEquals(acceptUpload(null, doc, "doc.pdf"), {
		ok: true,
		mime: "application/octet-stream",
		decode: false,
		metadata: doc,
		sanitize: false,
		inert: false,
	});
});

Deno.test("acceptUpload: a sniffed still is stored under its real type and must decode", () => {
	const verdict = acceptUpload(sniffBytes(new Uint8Array(PNG_HEAD)), null, "a.png");
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
