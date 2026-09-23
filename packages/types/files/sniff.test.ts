import { assert, assertEquals } from "@std/assert";
import { sniffBytes, unsupportedReason } from "./sniff.ts";

function bytes(...parts: Array<number[] | string>): Uint8Array {
	const out: number[] = [];
	for (const p of parts) {
		if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
		else out.push(...p);
	}
	while (out.length < 32) out.push(0);
	return new Uint8Array(out);
}

Deno.test("sniffBytes: recognises the four processable stills", () => {
	assertEquals(sniffBytes(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mime, "image/jpeg");
	assertEquals(sniffBytes(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.mime, "image/png");
	assertEquals(sniffBytes(bytes("GIF89a"))?.mime, "image/gif");
	assertEquals(sniffBytes(bytes("RIFF", [1, 2, 3, 4], "WEBP"))?.mime, "image/webp");
});

Deno.test("sniffBytes: ISO-BMFF brands tell AVIF/HEIC stills from MP4/MOV video", () => {
	assertEquals(sniffBytes(bytes([0, 0, 0, 24], "ftypavif"))?.mime, "image/avif");
	assertEquals(sniffBytes(bytes([0, 0, 0, 24], "ftypheic"))?.mime, "image/heic");
	assertEquals(sniffBytes(bytes([0, 0, 0, 24], "ftypisom"))?.mime, "video/mp4");
	assertEquals(sniffBytes(bytes([0, 0, 0, 20], "ftypqt  "))?.mime, "video/quicktime");
});

Deno.test("sniffBytes: EBML is WebM when the doctype says so, Matroska otherwise", () => {
	assertEquals(sniffBytes(bytes([0x1a, 0x45, 0xdf, 0xa3], "....webm"))?.mime, "video/webm");
	assertEquals(sniffBytes(bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska"))?.mime, "video/x-matroska");
});

Deno.test("sniffBytes: executables and markup are recognised so they can be refused by name", () => {
	assertEquals(sniffBytes(bytes("MZ"))?.family, "executable");
	assertEquals(sniffBytes(bytes([0x7f], "ELF"))?.family, "executable");
	assertEquals(sniffBytes(bytes("  <svg xmlns"))?.family, "markup");
	assertEquals(sniffBytes(bytes([0xef, 0xbb, 0xbf], "<!DOCTYPE html>"))?.family, "markup");
});

Deno.test("sniffBytes: a renamed file is judged by its bytes — a PNG called .jpg is a PNG", () => {
	assertEquals(sniffBytes(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.ext, "png");
	assertEquals(sniffBytes(bytes("just some text")), null);
});

Deno.test("unsupportedReason: processable formats pass; videos only where video is allowed", () => {
	assertEquals(unsupportedReason(sniffBytes(bytes([0xff, 0xd8, 0xff])), false), null);
	const mp4 = sniffBytes(bytes([0, 0, 0, 24], "ftypisom"));
	assertEquals(unsupportedReason(mp4, true), null);
	assert(unsupportedReason(mp4, false)?.includes("still image"));
	assert(unsupportedReason(sniffBytes(bytes([0, 0, 0, 24], "ftypheic")), false)?.includes("HEIC"));
	assert(unsupportedReason(sniffBytes(bytes("MZ")), true)?.includes("Programs"));
	assert(unsupportedReason(null, true)?.includes("JPG"));
});
