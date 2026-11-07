/**
 * tar-list — the table of contents of a tar archive, read off a stream. A tar has no directory, so
 * the only way to list one is to walk it, but the walk keeps nothing: each header is read, its payload
 * skipped, and memory stays flat however large the archive is.
 */

// #region Contract
/** One member of a tar archive. */
export interface TarEntry {
	path: string;
	directory: boolean;
	size: number;
	/** ISO time from the header; null when unset. */
	modified: string | null;
}

/** What a walk found; `truncated` when the archive holds more than {@link TarOptions.maxEntries}. */
export interface TarListing {
	entries: TarEntry[];
	truncated: boolean;
}

/** Options for {@link listTar}. */
export interface TarOptions {
	/** Stop listing after this many members. */
	maxEntries?: number;
}

/** Thrown for bytes that are not a tar archive. */
export class TarReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TarReadError";
	}
}
// #endregion

// #region Header
const BLOCK = 512;
const DEFAULT_MAX_ENTRIES = 100_000;
const MAX_META_BYTES = 1024 * 1024;
const decoder = new TextDecoder();

function field(block: Uint8Array, start: number, length: number): string {
	const slice = block.subarray(start, start + length);
	const end = slice.indexOf(0);
	return decoder.decode(end < 0 ? slice : slice.subarray(0, end));
}

function numeric(block: Uint8Array, start: number, length: number): number {
	if (block[start] & 0x80) {
		let value = block[start] & 0x7f;
		for (let i = start + 1; i < start + length; i++) value = value * 256 + block[i];
		return value;
	}
	return parseInt(field(block, start, length).trim() || "0", 8) || 0;
}

function checksumOk(block: Uint8Array): boolean {
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
	return sum === numeric(block, 148, 8);
}

/** The `path` record of a pax extended header, if it has one. */
export function paxPath(payload: Uint8Array): string | null {
	let at = 0;
	while (at < payload.length) {
		const space = payload.indexOf(32, at);
		if (space < 0) return null;
		const length = parseInt(decoder.decode(payload.subarray(at, space)), 10);
		if (!Number.isFinite(length) || length <= 0) return null;
		const record = decoder.decode(payload.subarray(space + 1, at + length - 1));
		if (record.startsWith("path=")) return record.slice(5);
		at += length;
	}
	return null;
}

function headerPath(block: Uint8Array): string {
	const name = field(block, 0, 100);
	const ustar = field(block, 257, 5) === "ustar";
	const prefix = ustar ? field(block, 345, 155) : "";
	return prefix ? `${prefix}/${name}` : name;
}
// #endregion

// #region Walk
/** Walk a tar stream to its end (or to `maxEntries`) and cancel what is left of it. */
export async function listTar(
	stream: ReadableStream<Uint8Array>,
	options: TarOptions = {},
): Promise<TarListing> {
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const entries: TarEntry[] = [];
	const reader = stream.getReader();
	const block = new Uint8Array(BLOCK);
	let filled = 0;
	let skip = 0;
	let meta: { type: string; bytes: Uint8Array; at: number } | null = null;
	let pendingPath: string | null = null;
	let truncated = false;
	let first = true;

	/** Take one finished header; false ends the walk. */
	const onHeader = (): boolean => {
		if (block.every((byte) => byte === 0)) return false;
		if (!checksumOk(block)) {
			if (first) throw new TarReadError("This file isn't a readable archive.");
			return false;
		}
		first = false;
		const size = numeric(block, 124, 12);
		const type = String.fromCharCode(block[156] || 48);
		const payload = Math.ceil(size / BLOCK) * BLOCK;
		if (type === "L" || type === "x") {
			const room = Math.min(size, MAX_META_BYTES);
			meta = { type, bytes: new Uint8Array(room), at: 0 };
			skip = payload;
			return true;
		}
		skip = payload;
		if (type === "K" || type === "g") return true;
		const path = (pendingPath ?? headerPath(block)).replaceAll("\\", "/").replace(/^(\.?\/)+/, "");
		pendingPath = null;
		if (path.length === 0) return true;
		if (entries.length >= maxEntries) {
			truncated = true;
			return false;
		}
		const mtime = numeric(block, 136, 12);
		entries.push({
			path,
			directory: type === "5" || path.endsWith("/"),
			size,
			modified: mtime > 0 ? new Date(mtime * 1000).toISOString() : null,
		});
		return true;
	};

	const onMetaDone = (): void => {
		const done = meta;
		meta = null;
		if (!done) return;
		pendingPath = done.type === "L"
			? decoder.decode(done.bytes).replace(/\0+$/, "")
			: paxPath(done.bytes) ?? pendingPath;
	};

	try {
		walk: while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			let at = 0;
			while (at < value.length) {
				if (skip > 0) {
					const take = Math.min(skip, value.length - at);
					if (meta) {
						const m: { bytes: Uint8Array; at: number } = meta;
						const room = Math.min(take, m.bytes.length - m.at);
						if (room > 0) m.bytes.set(value.subarray(at, at + room), m.at);
						m.at += Math.max(room, 0);
					}
					at += take;
					skip -= take;
					if (skip === 0) onMetaDone();
					continue;
				}
				const take = Math.min(BLOCK - filled, value.length - at);
				block.set(value.subarray(at, at + take), filled);
				filled += take;
				at += take;
				if (filled < BLOCK) continue;
				filled = 0;
				if (!onHeader()) break walk;
				if (skip === 0) onMetaDone();
			}
		}
	} finally {
		reader.cancel().catch(() => undefined);
	}
	return { entries, truncated };
}
// #endregion
