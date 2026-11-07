import { assertEquals, assertRejects } from "@std/assert";
import { openZip, type RangeReader, ZipReadError } from "./remote-zip.ts";

// #region A hand-built ZIP
const encoder = new TextEncoder();

function u16(value: number): number[] {
	return [value & 255, value >> 8];
}

function u32(value: number): number[] {
	return [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24];
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
		new CompressionStream("deflate-raw"),
	);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Spec {
	path: string;
	content?: string;
	deflate?: boolean;
	flags?: number;
	extraLocal?: number;
}

/** A real ZIP: local records, then the directory, then the end record. */
async function zipOf(specs: readonly Spec[], comment = ""): Promise<Uint8Array> {
	const body: number[] = [];
	const directory: number[] = [];
	for (const spec of specs) {
		const raw = encoder.encode(spec.content ?? "");
		const data = spec.deflate ? await deflateRaw(raw) : raw;
		const name = [...encoder.encode(spec.path)];
		const method = spec.deflate ? 8 : 0;
		const offset = body.length;
		const shared = [
			...u16(spec.flags ?? 0),
			...u16(method),
			...u16(0x6000),
			...u16(0x5a21),
			...u32(0),
			...u32(data.length),
			...u32(raw.length),
			...u16(name.length),
		];
		const localExtra = new Array(spec.extraLocal ?? 0).fill(0);
		body.push(
			...u32(0x04034b50),
			...u16(20),
			...shared,
			...u16(localExtra.length),
			...name,
			...localExtra,
		);
		for (const byte of data) body.push(byte);
		directory.push(
			...u32(0x02014b50),
			...u16(20),
			...u16(20),
			...shared,
			...u16(0),
			...u16(0),
			...u16(0),
			...u16(0),
			...u32(0),
			...u32(offset),
			...name,
		);
	}
	const end = [
		...u32(0x06054b50),
		...u16(0),
		...u16(0),
		...u16(specs.length),
		...u16(specs.length),
		...u32(directory.length),
		...u32(body.length),
		...u16(comment.length),
		...encoder.encode(comment),
	];
	return new Uint8Array([...body, ...directory, ...end]);
}

/** A reader over memory that records every range it was asked for. */
function reader(bytes: Uint8Array): { read: RangeReader; ranges: [number, number][] } {
	const ranges: [number, number][] = [];
	return {
		ranges,
		read: (start, end) => {
			ranges.push([start, end]);
			return Promise.resolve(bytes.subarray(start, end + 1));
		},
	};
}
// #endregion

Deno.test("the directory lists every entry with its size and date", async () => {
	const bytes = await zipOf([
		{ path: "docs/", content: "" },
		{ path: "docs/readme.txt", content: "hello", deflate: true },
		{ path: "./logo.bin", content: "abc" },
	]);
	const zip = await openZip(reader(bytes).read, bytes.length);
	assertEquals(zip.entries.map((e) => e.path), ["docs/", "docs/readme.txt", "logo.bin"]);
	assertEquals(zip.entries.map((e) => e.directory), [true, false, false]);
	assertEquals(zip.entries[1].size, 5);
	assertEquals(zip.entries[1].modified, "2025-01-01T12:00:00");
});

Deno.test("a stored and a deflated entry both read back", async () => {
	const bytes = await zipOf([
		{ path: "a.txt", content: "stored" },
		{ path: "b.txt", content: "deflated ".repeat(40), deflate: true },
		{ path: "c.txt", content: "padded", extraLocal: 12 },
	]);
	const zip = await openZip(reader(bytes).read, bytes.length);
	assertEquals(await zip.text(zip.find("a.txt")!), "stored");
	assertEquals(await zip.text(zip.find("b.txt")!), "deflated ".repeat(40));
	assertEquals(await zip.text(zip.find("c.txt")!), "padded");
});

Deno.test("a trailing comment does not hide the end record", async () => {
	const bytes = await zipOf([{ path: "a.txt", content: "x" }], "made by a test");
	const zip = await openZip(reader(bytes).read, bytes.length);
	assertEquals(zip.entries.length, 1);
});

Deno.test("reading one entry touches only that entry's bytes", async () => {
	const big = "x".repeat(200_000);
	const bytes = await zipOf([
		{ path: "big.bin", content: big },
		{ path: "small.txt", content: "tiny" },
	]);
	const { read, ranges } = reader(bytes);
	const zip = await openZip(read, bytes.length);
	ranges.length = 0;
	assertEquals(await zip.text(zip.find("small.txt")!), "tiny");
	for (const [start] of ranges) assertEquals(start >= 200_000, true);
});

Deno.test("a limit reads the head of an entry and stops", async () => {
	const lines = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
	const bytes = await zipOf([{ path: "doc.xml", content: lines, deflate: true }]);
	const zip = await openZip(reader(bytes).read, bytes.length);
	const head = await zip.text(zip.find("doc.xml")!, { limit: 256 });
	assertEquals(head.length, 256);
	assertEquals(head, lines.slice(0, 256));
});

Deno.test("what cannot be read is refused rather than guessed at", async () => {
	const notZip = new TextEncoder().encode("plain text, not an archive, long enough to scan");
	await assertRejects(() => openZip(reader(notZip).read, notZip.length), ZipReadError);

	const bytes = await zipOf([{ path: "secret.txt", content: "x", flags: 1 }]);
	const zip = await openZip(reader(bytes).read, bytes.length);
	assertEquals(zip.entries[0].encrypted, true);
	await assertRejects(() => zip.bytes(zip.entries[0]), ZipReadError, "password");
});
