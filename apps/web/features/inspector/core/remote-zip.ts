/// <reference lib="dom" />
/**
 * remote-zip — a ZIP read a piece at a time over HTTP `Range`, through the media proxy. A ZIP keeps
 * its table of contents at the end, so a 2 GB archive lists from its last few kilobytes and one entry
 * of a Word file costs one entry's bytes. `DecompressionStream` does the inflating, so no decoder
 * ships for it.
 *
 * Everything here is written against a {@link RangeReader}, so the format logic runs in a test with
 * no network. A server that ignores `Range` still works: {@link openRemoteZip} keeps the whole body
 * the first time it is handed one.
 */

// #region Contract
/** Read bytes `start..end`, inclusive of both. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

/** One entry of a ZIP's central directory. */
export interface ZipEntry {
	path: string;
	directory: boolean;
	size: number;
	packedSize: number;
	method: number;
	offset: number;
	encrypted: boolean;
	/** ISO local time from the entry's DOS timestamp; null when unset. */
	modified: string | null;
}

/** Thrown for bytes that are not a readable ZIP, or an entry this reader cannot decode. */
export class ZipReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZipReadError";
	}
}

/** Options for {@link readZipEntry}. */
export interface ZipReadOptions {
	/**
	 * Stop after this many decoded bytes and read no more of the entry than that many packed ones,
	 * which is what lets a card preview read the head of a 40 MB `document.xml`. A deflated stream
	 * never expands below its packed size, so the budget always yields at least that much.
	 */
	limit?: number;
}

/** A ZIP opened for reading. */
export interface RemoteZip {
	readonly entries: readonly ZipEntry[];
	/** The entry at this exact path. */
	find(path: string): ZipEntry | null;
	bytes(entry: ZipEntry, options?: ZipReadOptions): Promise<Uint8Array>;
	text(entry: ZipEntry, options?: ZipReadOptions): Promise<string>;
}
// #endregion

// #region Format
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const TAIL_BYTES = EOCD_SIZE + 0xffff + ZIP64_LOCATOR_SIZE;
const LOCAL_SIZE = 30;
const LOCAL_SLACK = 1024;
const STORED = 0;
const DEFLATE = 8;
/** Generous for any real archive; a directory claiming more is hostile or corrupt. */
const MAX_DIRECTORY_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function bigToNumber(value: bigint): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipReadError("This archive is too large.");
	return Number(value);
}

function dosTime(date: number, time: number): string | null {
	if (date === 0) return null;
	const year = (date >> 9) + 1980;
	const pad = (n: number) => String(n).padStart(2, "0");
	const day = `${year}-${pad((date >> 5) & 15)}-${pad(date & 31)}`;
	return `${day}T${pad(time >> 11)}:${pad((time >> 5) & 63)}:${pad((time & 31) * 2)}`;
}

interface Directory {
	offset: number;
	size: number;
	count: number;
}

function findEocd(tail: DataView): number {
	for (let at = tail.byteLength - EOCD_SIZE; at >= 0; at--) {
		if (tail.getUint32(at, true) === EOCD) return at;
	}
	throw new ZipReadError("This file isn't a readable archive.");
}

async function locateDirectory(read: RangeReader, size: number): Promise<Directory> {
	if (size < EOCD_SIZE) throw new ZipReadError("This file isn't a readable archive.");
	const tailStart = Math.max(0, size - TAIL_BYTES);
	const tail = view(await read(tailStart, size - 1));
	const eocd = findEocd(tail);
	const plain: Directory = {
		count: tail.getUint16(eocd + 10, true),
		size: tail.getUint32(eocd + 12, true),
		offset: tail.getUint32(eocd + 16, true),
	};
	const wide = plain.count === 0xffff || plain.size === 0xffffffff || plain.offset === 0xffffffff;
	const locator = eocd - ZIP64_LOCATOR_SIZE;
	if (!wide || locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) return plain;

	const recordAt = bigToNumber(tail.getBigUint64(locator + 8, true));
	const record = view(await read(recordAt, recordAt + 55));
	if (record.getUint32(0, true) !== ZIP64_EOCD) {
		throw new ZipReadError("This archive's directory is damaged.");
	}
	return {
		count: bigToNumber(record.getBigUint64(32, true)),
		size: bigToNumber(record.getBigUint64(40, true)),
		offset: bigToNumber(record.getBigUint64(48, true)),
	};
}

/** Widen the fields a ZIP64 extra block replaces, in the order the format lists them. */
function applyZip64(
	extra: DataView,
	fields: { size: number; packedSize: number; offset: number },
): void {
	for (let at = 0; at + 4 <= extra.byteLength;) {
		const id = extra.getUint16(at, true);
		const length = extra.getUint16(at + 2, true);
		if (id === 1) {
			let read = at + 4;
			for (const key of ["size", "packedSize", "offset"] as const) {
				if (fields[key] !== 0xffffffff || read + 8 > extra.byteLength) continue;
				fields[key] = bigToNumber(extra.getBigUint64(read, true));
				read += 8;
			}
			return;
		}
		at += 4 + length;
	}
}

function normalizePath(raw: string): string {
	return raw.replaceAll("\\", "/").replace(/^(\.?\/)+/, "");
}

/** Parse a whole central directory. */
export function parseCentralDirectory(bytes: Uint8Array, count: number): ZipEntry[] {
	const data = view(bytes);
	const names = new TextDecoder();
	const entries: ZipEntry[] = [];
	let at = 0;
	for (let i = 0; i < count; i++) {
		if (at + 46 > bytes.length || data.getUint32(at, true) !== CENTRAL) {
			throw new ZipReadError("This archive's directory is damaged.");
		}
		const flags = data.getUint16(at + 8, true);
		const nameLength = data.getUint16(at + 28, true);
		const extraLength = data.getUint16(at + 30, true);
		const commentLength = data.getUint16(at + 32, true);
		const fields = {
			packedSize: data.getUint32(at + 20, true),
			size: data.getUint32(at + 24, true),
			offset: data.getUint32(at + 42, true),
		};
		const nameAt = at + 46;
		const extraAt = nameAt + nameLength;
		applyZip64(new DataView(bytes.buffer, bytes.byteOffset + extraAt, extraLength), fields);
		const path = normalizePath(names.decode(bytes.subarray(nameAt, extraAt)));
		entries.push({
			path,
			directory: path.endsWith("/"),
			size: fields.size,
			packedSize: fields.packedSize,
			method: data.getUint16(at + 10, true),
			offset: fields.offset,
			encrypted: (flags & 1) === 1,
			modified: dosTime(data.getUint16(at + 14, true), data.getUint16(at + 12, true)),
		});
		at = extraAt + extraLength + commentLength;
	}
	return entries;
}

/** Read a ZIP's table of contents from its tail. */
export async function readZipDirectory(read: RangeReader, size: number): Promise<ZipEntry[]> {
	const directory = await locateDirectory(read, size);
	if (directory.size > MAX_DIRECTORY_BYTES) throw new ZipReadError("This archive is too large.");
	if (directory.count === 0) return [];
	const bytes = await read(directory.offset, directory.offset + directory.size - 1);
	return parseCentralDirectory(bytes, directory.count);
}

async function inflate(packed: Uint8Array, limit: number, partial: boolean): Promise<Uint8Array> {
	if (typeof DecompressionStream === "undefined") {
		throw new ZipReadError("This browser can't unpack archives.");
	}
	const source = new Blob([packed as BlobPart]).stream();
	const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (total < limit) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
	} catch (error) {
		// A head read stops the packed bytes mid-stream, so the decoder's complaint is expected there.
		if (!partial || total === 0) throw new ZipReadError(String(error));
	} finally {
		reader.cancel().catch(() => undefined);
	}
	const out = new Uint8Array(Math.min(total, limit));
	let at = 0;
	for (const chunk of chunks) {
		const room = out.length - at;
		if (room <= 0) break;
		out.set(chunk.subarray(0, room), at);
		at += Math.min(room, chunk.length);
	}
	return out;
}

/** Read one entry's bytes, up to its `limit`. */
export async function readZipEntry(
	read: RangeReader,
	entry: ZipEntry,
	options: ZipReadOptions = {},
): Promise<Uint8Array> {
	if (entry.encrypted) throw new ZipReadError("This entry is password-protected.");
	if (entry.method !== STORED && entry.method !== DEFLATE) {
		throw new ZipReadError("This entry uses a compression this viewer can't read.");
	}
	const limit = Math.min(options.limit ?? MAX_ENTRY_BYTES, MAX_ENTRY_BYTES);
	const packedWanted = Math.min(entry.packedSize, limit);
	const head = await read(entry.offset, entry.offset + LOCAL_SIZE + LOCAL_SLACK + packedWanted - 1);
	const local = view(head);
	if (local.byteLength < LOCAL_SIZE || local.getUint32(0, true) !== LOCAL) {
		throw new ZipReadError("This archive is damaged.");
	}
	const dataAt = LOCAL_SIZE + local.getUint16(26, true) + local.getUint16(28, true);
	let packed = head.subarray(dataAt, dataAt + packedWanted);
	if (packed.length < packedWanted) {
		const start = entry.offset + dataAt;
		packed = await read(start, start + packedWanted - 1);
	}
	if (entry.method === STORED) return packed.subarray(0, limit);
	return await inflate(packed, limit, packedWanted < entry.packedSize);
}

/** A {@link RemoteZip} over any reader; the seam {@link openRemoteZip} and the tests share. */
export async function openZip(read: RangeReader, size: number): Promise<RemoteZip> {
	const entries = await readZipDirectory(read, size);
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	const decoder = new TextDecoder();
	return {
		entries,
		find: (path) => byPath.get(path) ?? null,
		bytes: (entry, options) => readZipEntry(read, entry, options),
		text: async (entry, options) => decoder.decode(await readZipEntry(read, entry, options)),
	};
}
// #endregion

// #region HTTP
/** A {@link RangeReader} over a same-origin address. */
export function httpRangeReader(src: string, size: number, signal?: AbortSignal): RangeReader {
	let whole: Uint8Array | null = null;
	return async (start, end) => {
		const last = Math.min(end, size - 1);
		if (whole) return whole.subarray(start, last + 1);
		const res = await fetch(src, {
			headers: { range: `bytes=${start}-${last}` },
			credentials: "same-origin",
			signal,
		});
		if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
		if (!res.ok) {
			await res.body?.cancel();
			throw new ZipReadError("This file couldn't be loaded.");
		}
		whole = new Uint8Array(await res.arrayBuffer());
		return whole.subarray(start, last + 1);
	};
}

/** Open a ZIP at a same-origin address, reading only its directory. */
export function openRemoteZip(
	src: string,
	size: number,
	signal?: AbortSignal,
): Promise<RemoteZip> {
	return openZip(httpRangeReader(src, size, signal), size);
}
// #endregion
