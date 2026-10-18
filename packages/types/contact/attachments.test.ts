/**
 * The contact attachments' rules (Decision #276): the up-front check against the `contact` bucket's
 * limits, what landed bytes are judged to be, and the phase each stored status reads as.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { BUCKETS } from "../files/storage.ts";
import { sniffBytes } from "../files/sniff.ts";
import {
	classifyContactBytes,
	CONTACT_ATTACHMENT_ACCEPT,
	CONTACT_ATTACHMENT_MAX_BYTES,
	CONTACT_ATTACHMENT_MAX_FILES,
	CONTACT_ATTACHMENT_MIME,
	ContactAttachmentInitSchema,
	contactAttachmentLimitsText,
	contactAttachmentProblem,
	formatBytes,
	looksLikeText,
	mimeFromName,
	phaseForFileStatus,
} from "./attachments.ts";

const MB = 1024 * 1024;
const ascii = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

Deno.test("the limits are the contact bucket's own", () => {
	assertEquals(CONTACT_ATTACHMENT_MAX_BYTES, BUCKETS.contact.maxBytes);
	assertEquals(CONTACT_ATTACHMENT_MAX_BYTES, 10 * MB);
	assertEquals([...CONTACT_ATTACHMENT_MIME], [...(BUCKETS.contact.allowedMime ?? [])]);
	assertEquals(CONTACT_ATTACHMENT_MAX_FILES, 5);
	assertEquals(BUCKETS.contact.access, "private");
	for (const mime of CONTACT_ATTACHMENT_MIME) assert(CONTACT_ATTACHMENT_ACCEPT.includes(mime));
	assertEquals(
		contactAttachmentLimitsText(),
		"Up to 5 files, 10 MB each · PNG, JPEG, WebP, GIF, PDF or plain text",
	);
});

Deno.test("contactAttachmentProblem: empty, too large, or a type the bucket does not take", () => {
	assertEquals(contactAttachmentProblem({ name: "a.png", type: "image/png", size: 2048 }), null);
	assertEquals(
		contactAttachmentProblem({ name: "notes.txt", type: "", size: 10 }),
		null,
		"a type from the name",
	);
	assert(
		contactAttachmentProblem({ name: "a.png", type: "image/png", size: 0 })?.includes("empty"),
	);
	assert(
		contactAttachmentProblem({ name: "a.pdf", type: "application/pdf", size: 10 * MB + 1 })
			?.includes("10 MB"),
	);
	assert(
		contactAttachmentProblem({ name: "a.svg", type: "image/svg+xml", size: 10 })?.includes(
			"isn't a type",
		),
	);
	assert(contactAttachmentProblem({ name: "a.zip", type: "", size: 10 })?.includes("isn't a type"));
});

Deno.test("mimeFromName: the six accepted extensions, case-blind", () => {
	assertEquals(mimeFromName("A.JPG"), "image/jpeg");
	assertEquals(mimeFromName("scan.jpeg"), "image/jpeg");
	assertEquals(mimeFromName("doc.PDF"), "application/pdf");
	assertEquals(mimeFromName("log.txt"), "text/plain");
	assertEquals(mimeFromName("x.webp"), "image/webp");
	assertEquals(mimeFromName("x.gif"), "image/gif");
	assertEquals(mimeFromName("archive.zip"), null);
	assertEquals(mimeFromName("noext"), null);
});

Deno.test("classifyContactBytes: the bytes decide, not the name", () => {
	assertEquals(classifyContactBytes(sniffBytes(PNG), "image/png", PNG), {
		ok: true,
		mime: "image/png",
	});
	assertEquals(classifyContactBytes(sniffBytes(PNG), "application/pdf", PNG), {
		ok: true,
		mime: "image/png",
	});
	const exe = classifyContactBytes(sniffBytes(EXE), "image/png", EXE);
	assert(!exe.ok && exe.hostile, "a program is refused as hostile");
	const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
	const markup = classifyContactBytes(sniffBytes(svg), "text/plain", svg);
	assert(!markup.ok && markup.hostile, "markup is refused as hostile");
	const pdf = ascii("%PDF-1.7\n%âãÏÓ\n");
	assertEquals(classifyContactBytes(sniffBytes(pdf), "application/pdf", pdf), {
		ok: true,
		mime: "application/pdf",
	});
	assertFalse(
		classifyContactBytes(sniffBytes(pdf), "image/png", pdf).ok,
		"an unrecognised format must match its declaration",
	);
	const text = ascii("Steps to reproduce:\n1. Sign in\n2. Open /wallet\n");
	assertEquals(classifyContactBytes(sniffBytes(text), "text/plain", text), {
		ok: true,
		mime: "text/plain",
	});
	const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]);
	const unknown = classifyContactBytes(sniffBytes(binary), "text/plain", binary);
	assert(!unknown.ok && !unknown.hostile, "unknown bytes are refused, not called hostile");
	const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
	const video = classifyContactBytes(sniffBytes(mp4), "image/png", mp4);
	assert(!video.ok && !video.hostile, "a recognised type the bucket does not take");
});

Deno.test("looksLikeText: no NUL byte, valid UTF-8", () => {
	assert(looksLikeText(ascii("héllo wörld")));
	assertFalse(looksLikeText(new Uint8Array([0x68, 0x00, 0x69])));
	assertFalse(looksLikeText(new Uint8Array([0xc3, 0x28])));
});

Deno.test("formatBytes: people's units", () => {
	assertEquals(formatBytes(0), "0 B");
	assertEquals(formatBytes(512), "512 B");
	assertEquals(formatBytes(2048), "2 KB");
	assertEquals(formatBytes(1.5 * MB), "1.5 MB");
	assertEquals(formatBytes(10 * MB), "10 MB");
	assertEquals(formatBytes(Number.NaN), "0 B");
});

Deno.test("phaseForFileStatus: the files pipeline's states as the dropzone shows them", () => {
	assertEquals(phaseForFileStatus("pending_upload"), "uploading");
	assertEquals(phaseForFileStatus("scanning"), "scanning");
	assertEquals(phaseForFileStatus("uploaded"), "ready");
	assertEquals(phaseForFileStatus("error"), "refused");
	assertEquals(phaseForFileStatus("quarantined"), "refused");
});

Deno.test("ContactAttachmentInitSchema: the up-front check is part of the declaration", () => {
	assert(
		ContactAttachmentInitSchema.safeParse({ name: "a.png", mimeType: "image/png", sizeBytes: 10 })
			.success,
	);
	assertFalse(
		ContactAttachmentInitSchema.safeParse({
			name: "a.exe",
			mimeType: "application/x-msdownload",
			sizeBytes: 10,
		}).success,
	);
	assertFalse(
		ContactAttachmentInitSchema.safeParse({
			name: "a.png",
			mimeType: "image/png",
			sizeBytes: 11 * MB,
		}).success,
	);
});
