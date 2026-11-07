import { assertEquals, assertRejects } from "@std/assert";
import { listTar, paxPath, TarReadError } from "./tar-list.ts";

// #region A hand-built tar
const encoder = new TextEncoder();
const BLOCK = 512;

function octal(value: number, width: number): string {
	return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

interface Spec {
	name: string;
	content?: string;
	type?: string;
	prefix?: string;
}

function member({ name, content = "", type = "0", prefix = "" }: Spec): number[] {
	const header = new Uint8Array(BLOCK);
	const body = encoder.encode(content);
	const put = (text: string, at: number) => header.set(encoder.encode(text), at);
	put(name, 0);
	put(octal(0o644, 8), 100);
	put(octal(body.length, 12), 124);
	put(octal(1_700_000_000, 12), 136);
	put(type, 156);
	put("ustar\0", 257);
	put("00", 263);
	put(prefix, 345);
	put("        ", 148);
	const sum = header.reduce((total, byte) => total + byte, 0);
	put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
	const padded = new Uint8Array(Math.ceil(body.length / BLOCK) * BLOCK);
	padded.set(body);
	return [...header, ...padded];
}

function tarOf(specs: readonly Spec[]): Uint8Array {
	return new Uint8Array([...specs.flatMap(member), ...new Array(BLOCK * 2).fill(0)]);
}

/** Stream bytes in small chunks, so headers and payloads straddle reads as they do off a network. */
function streamOf(bytes: Uint8Array, chunk = 137): ReadableStream<Uint8Array> {
	let at = 0;
	return new ReadableStream({
		pull(controller) {
			if (at >= bytes.length) return controller.close();
			controller.enqueue(bytes.subarray(at, at + chunk));
			at += chunk;
		},
	});
}
// #endregion

Deno.test("a walk lists names, sizes and folders across chunk boundaries", async () => {
	const { entries, truncated } = await listTar(streamOf(tarOf([
		{ name: "src/", type: "5" },
		{ name: "src/main.ts", content: "x".repeat(1000) },
		{ name: "readme.md", content: "hi" },
	])));
	assertEquals(entries.map((e) => [e.path, e.directory, e.size]), [
		["src/", true, 0],
		["src/main.ts", false, 1000],
		["readme.md", false, 2],
	]);
	assertEquals(entries[1].modified, "2023-11-14T22:13:20.000Z");
	assertEquals(truncated, false);
});

Deno.test("a ustar prefix, a GNU long name and a pax path are all honoured", async () => {
	const long = `${"deep/".repeat(30)}file.txt`;
	const record = `path=${long}\n`;
	const size = String(record.length + 4);
	const pax = `${size} ${record}`;
	const { entries } = await listTar(streamOf(tarOf([
		{ name: "file.txt", prefix: "a/b" },
		{ name: "././@LongLink", type: "L", content: `${long}\0` },
		{ name: "ignored", content: "1" },
		{ name: "PaxHeader", type: "x", content: pax },
		{ name: "ignored-too", content: "22" },
	])));
	assertEquals(entries.map((e) => e.path), ["a/b/file.txt", long, long]);
	assertEquals(entries[2].size, 2);
});

Deno.test("the listing stops at its ceiling and says so", async () => {
	const { entries, truncated } = await listTar(
		streamOf(tarOf([{ name: "a" }, { name: "b" }, { name: "c" }])),
		{ maxEntries: 2 },
	);
	assertEquals(entries.length, 2);
	assertEquals(truncated, true);
});

Deno.test("bytes that are not a tar are refused on the first block", async () => {
	const junk = new Uint8Array(BLOCK * 2).fill(65);
	await assertRejects(() => listTar(streamOf(junk)), TarReadError);
});

Deno.test("a gzip stream of a tar lists the same way", async () => {
	const gz = new Blob([tarOf([{ name: "only.txt", content: "z" }]) as BlobPart]).stream()
		.pipeThrough(new CompressionStream("gzip"))
		.pipeThrough(new DecompressionStream("gzip"));
	const { entries } = await listTar(gz);
	assertEquals(entries.map((e) => e.path), ["only.txt"]);
});

Deno.test("paxPath ignores a header with no path record", () => {
	assertEquals(paxPath(encoder.encode("12 uid=1000\n")), null);
});
