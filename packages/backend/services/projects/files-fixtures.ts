import type {
	FileChannelRef,
	FileItem,
	FileKind,
	FileListPage,
	FileListParams,
	FileSortDir,
	FileSortKey,
	MessageSender,
	ProjectDetail,
} from "@projective/types/projects";
import { categorizeFile } from "@projective/types/files";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * projects files fixtures — the fat {@link ProjectBackendService}'s in-memory answer for the File
 * Explorer read (`/projects/[projectId]/files` + the channel-scoped
 * `/projects/[projectId]/[channelId]/files`) while `PROJECTS_BACKEND_LIVE` is off (thin-frontend
 * pattern, root CLAUDE.md §10). Like {@link findMessagePage} it DERIVES a deterministic file corpus
 * from the resolved {@link ProjectDetail} — every channel the tree shows contributes a stable set of
 * "posts" (a sender + a message + 1–4 attachments), flattened into {@link FileItem} rows — so the
 * explorer always agrees with the channels that opened it. No RNG: a slug+channel hash seeds the
 * variation and a fixed reference clock keeps SSR and the island's refetch identical. The live path
 * (RLS-scoped `files.*` / `messages.*` attachments) replaces this builder behind the same gate with
 * zero shape churn (the projection is already the SSOT {@link FileListPageSchema}).
 */

// #region Reference clock + deterministic helpers
/** Fixed reference "now" (no `Date.now()`), matching the messages fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `h:mm AM/PM` from a timestamp (UTC components — server-tz-independent, so SSR == refetch). */
function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** `Today` / `Yesterday` / `Mon, Jul 14` relative to {@link NOW} (UTC day math). */
function fmtDay(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Jul 14 · 2:30 PM` — the absolute label the grid hover + list column show. */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${fmtTime(ms)}`;
}

/** `m:ss` from a duration in ms. */
function fmtDuration(ms: number): string {
	const total = Math.round(ms / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Human byte size ("2.4 MB") from raw bytes. */
function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}
// #endregion

// #region Media pool (Unsplash crops — open registry, §C.4)
const IMG = (id: string, w: number, h: number): { url: string; w: number; h: number } => ({
	url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`,
	w,
	h,
});

/** A spread of aspect ratios so the list's native-ratio thumbnails vary realistically. */
const PHOTOS = [
	IMG("photo-1618005182384-a83a8bd57fbe", 1200, 800),
	IMG("photo-1558655146-9f40138edfeb", 900, 1200),
	IMG("photo-1550684848-fac1c5b4e853", 1200, 900),
	IMG("photo-1620121692029-d088224ddc74", 1000, 1000),
	IMG("photo-1611262588024-d12430b98920", 1200, 675),
	IMG("photo-1626785774573-4b799315345d", 800, 1000),
	IMG("photo-1517245386807-bb43f82c33c4", 1200, 800),
	IMG("photo-1499951360447-b19be8fe80f5", 1100, 733),
];
// #endregion

// #region Participants
/** The acting viewer — their files can be renamed inline in the preview modal. */
const VIEWER: MessageSender = {
	id: "viewer",
	name: "You",
	avatar:
		"https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	handle: "you",
};

function partyToSender(
	id: string,
	name: string,
	avatar: string | null,
	handle: string | null,
): MessageSender {
	return { id, name, avatar, handle };
}

/** The non-viewer cast for a channel (max 4), always including the viewer so "own files" exist. */
function groupSenders(detail: ProjectDetail): MessageSender[] {
	const cast = detail.members
		.slice(0, 4)
		.map((m) => partyToSender(m.id, m.party.name, m.party.avatar, m.party.handle));
	const others = cast.length > 0 ? cast : [
		partyToSender(
			`${detail.slug}-owner`,
			detail.owner.name,
			detail.owner.avatar,
			detail.owner.handle,
		),
	];
	return [VIEWER, ...others];
}
// #endregion

// #region Channel descriptors
type ChannelKind = FileItem["channelKind"];
interface ChanDesc {
	id: string;
	name: string;
	kind: ChannelKind;
	senders: MessageSender[];
}

/** Flatten a project's four channel groups into a single ordered descriptor list. */
function channelsOf(detail: ProjectDetail): ChanDesc[] {
	const cast = groupSenders(detail);
	const out: ChanDesc[] = [];
	for (const g of detail.channels.general) {
		out.push({ id: g.id, name: g.name, kind: "general", senders: cast });
	}
	for (const s of detail.channels.stages) {
		out.push({ id: s.channel.id, name: s.name, kind: "stage", senders: cast });
	}
	for (const t of detail.channels.teams) {
		for (const c of t.channels) {
			out.push({ id: c.id, name: `${t.teamName} · ${c.name}`, kind: "team", senders: cast });
		}
	}
	for (const d of detail.channels.dms) {
		const other = partyToSender(d.chatId, d.party.name, d.party.avatar, d.party.handle);
		out.push({ id: d.chatId, name: d.party.name, kind: "dm", senders: [VIEWER, other] });
	}
	return out;
}
// #endregion

// #region Post shapes & pools
/** The attachment shape of a "post" — siblings share a message id → the modal's carousel group. */
const POST_SHAPES: FileKind[][] = [
	["image", "image", "image"],
	["image"],
	["video"],
	["pdf"],
	["pdf", "archive"],
	["image", "image"],
	["code", "code"],
	["doc"],
	["audio"],
	["image", "pdf", "archive"],
	["image", "video"],
	["code"],
	["image", "image", "image", "image"],
	["doc", "pdf"],
];

const POST_TEXT = [
	"Sharing the latest direction — feedback welcome.",
	"Uploaded the final export pack.",
	"Here's the source + the compiled deliverable.",
	"Voice note walking through the changes.",
	"Concept round two, pushed the type a touch bolder.",
	"Attached the brief and the reference board.",
	"Retina assets are in — let me know if the crops work.",
	"Wrapped the walkthrough recording.",
	"Design tokens + the component snapshot.",
	"Signed contract + the invoice for this stage.",
	"",
	"Quick moodboard before the review call.",
];

const NAMES: Record<FileKind, string[]> = {
	image: [
		"concept",
		"moodboard",
		"hero-shot",
		"palette",
		"layout",
		"screenshot",
		"wireframe",
		"banner",
	],
	video: ["walkthrough", "demo-reel", "screen-record", "handoff-clip"],
	audio: ["voice-note", "review-call", "brief-audio", "feedback"],
	pdf: ["concept-deck", "brand-guidelines", "project-brief", "invoice", "contract", "spec-sheet"],
	doc: ["scope-of-work", "meeting-notes", "content-plan", "proposal"],
	code: ["tokens", "theme", "button", "config", "schema", "index"],
	archive: ["source-files", "export-pack", "assets-bundle", "deliverables"],
	file: ["attachment", "file", "asset"],
};

const EXTS: Record<FileKind, string[]> = {
	image: ["png", "jpg", "webp"],
	video: ["mp4", "mov"],
	audio: ["mp3", "wav", "m4a"],
	pdf: ["pdf"],
	doc: ["docx", "pages", "rtf"],
	code: ["ts", "tsx", "css", "json"],
	archive: ["zip", "rar"],
	file: ["bin"],
};

/** A plausible byte size per kind, deterministic in `n`. */
function sizeFor(kind: FileKind, n: number): number {
	const r = n % 1000;
	switch (kind) {
		case "image":
			return 220_000 + r * 3_200; // ~0.2–3.4 MB
		case "video":
			return 8_000_000 + r * 42_000; // ~8–50 MB
		case "audio":
			return 900_000 + r * 7_000; // ~0.9–8 MB
		case "pdf":
			return 180_000 + r * 6_000; // ~0.2–6.2 MB
		case "doc":
			return 40_000 + r * 2_000; // ~40 KB–2 MB
		case "code":
			return 1_200 + r * 90; // ~1–92 KB
		case "archive":
			return 2_400_000 + r * 60_000; // ~2.4–62 MB
		default:
			return 100_000 + r * 1_000;
	}
}
// #endregion

// #region Builder
/** Build the full, unsorted, unfiltered file corpus for one channel (newest post last). */
function filesForChannel(detail: ProjectDetail, chan: ChanDesc): FileItem[] {
	// A couple of channel ids stand in for genuinely empty channels (demonstrates the empty state).
	if (/announce|empty/i.test(chan.id)) return [];

	const seed = hash(`${detail.slug}:${chan.id}`);
	const postCount = 6 + (seed % 6); // 6–11 posts per channel
	const items: FileItem[] = [];

	// Walk timestamps back from NOW so the newest posts sit at the tail.
	let ts = NOW - postCount * 7 * HOUR;

	for (let p = 0; p < postCount; p++) {
		const pseed = hash(`${chan.id}:${p}:${seed}`);
		const shape = POST_SHAPES[pseed % POST_SHAPES.length];
		const sender = chan.senders[(seed + p) % chan.senders.length];
		const messageId = `${chan.id}-post-${p}`;
		const text = POST_TEXT[(pseed + p) % POST_TEXT.length];
		const hasAudioNote = shape.includes("audio") ? false : (pseed % 7 === 0);
		ts += 4 * HOUR + (pseed % 5) * HOUR + (p % 3) * 40 * MIN;

		shape.forEach((kind, i) => {
			const fseed = hash(`${messageId}:${i}`);
			const names = NAMES[kind];
			const exts = EXTS[kind];
			const base = names[(fseed + i) % names.length];
			// `>>> 3` (unsigned) — a signed `>>` would go negative for hashes above 2^31 → a negative
			// array index → `undefined` ext (a "….undefined" filename). Keep every index unsigned.
			const ext = exts[(fseed >>> 3) % exts.length];
			const isVisual = kind === "image" || kind === "video";
			const photo = PHOTOS[(fseed + i) % PHOTOS.length];
			const bytes = sizeFor(kind, fseed);
			const created = ts + i * 20_000; // stagger siblings a hair for stable sort
			const durMs = kind === "video"
				? (30 + (fseed % 210)) * 1000
				: kind === "audio"
				? (12 + (fseed % 180)) * 1000
				: 0;

			items.push({
				id: `${messageId}-${i}`,
				kind,
				category: categorizeFile(`x.${ext}`),
				name: `${base}-${(p % 4) + 1}${
					kind === "image" && shape.filter((k) => k === "image").length > 1 ? `-${i + 1}` : ""
				}.${ext}`,
				ext,
				url: isVisual ? photo.url : "#",
				thumbnailUrl: isVisual ? photo.url : null,
				sizeBytes: bytes,
				sizeLabel: fmtSize(bytes),
				width: isVisual ? photo.w : null,
				height: isVisual ? photo.h : null,
				durationLabel: durMs ? fmtDuration(durMs) : null,
				channelId: chan.id,
				channelName: chan.name,
				channelKind: chan.kind,
				messageId,
				messageText: text,
				messageAudioUrl: hasAudioNote ? "#" : null,
				sender,
				createdAt: new Date(created).toISOString(),
				timeLabel: fmtTime(created),
				dayLabel: fmtDay(created),
				dateLabel: fmtDateTime(created),
				starred: fseed % 11 === 0,
			});
		});
	}

	return items;
}

/** The full corpus for a scope: one channel, or every channel (project scope). */
function corpusFor(detail: ProjectDetail, channelId: string | null | undefined): {
	items: FileItem[];
	channels: FileChannelRef[];
} {
	const chans = channelsOf(detail);
	const scoped = channelId ? chans.filter((c) => c.id === channelId) : chans;

	// The channel index (tree top level) — counts reflect the WHOLE channel, filter-independent. In
	// channel scope it is just the one channel; in project scope every channel that holds files.
	const channels: FileChannelRef[] = [];
	const items: FileItem[] = [];
	for (const c of scoped) {
		const f = filesForChannel(detail, c);
		items.push(...f);
		channels.push({ id: c.id, name: c.name, kind: c.kind, count: f.length });
	}
	return { items, channels };
}
// #endregion

// #region Filter + sort + page
function matches(item: FileItem, params: FileListParams): boolean {
	if (params.kinds && params.kinds.length > 0 && !params.kinds.includes(item.kind)) return false;
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}

const SORTERS: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};

function sortItems(items: FileItem[], sort: FileSortKey, dir: FileSortDir): FileItem[] {
	const cmp = SORTERS[sort];
	const sorted = items.slice().sort(cmp);
	// A stable tiebreak by id keeps paging deterministic when the key ties.
	sorted.sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
	return dir === "desc" ? sorted.reverse() : sorted;
}

const DEFAULT_LIMIT = 60;

/**
 * Resolve a page of files. `channelId` unset/null → the whole project; set → that channel only.
 * Returns `null` only when the PROJECT itself resolves to nothing (the route maps that to a 404); an
 * empty-but-valid channel yields a page with no items so the explorer can show its empty state.
 */
export function findFilePage(params: FileListParams): FileListPage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;

	const channelId = params.channelId ?? null;
	const { items, channels } = corpusFor(detail, channelId);

	const sort = params.sort ?? "date";
	const dir = params.dir ?? (sort === "date" ? "desc" : "asc");

	const matched = items.filter((it) => matches(it, params));
	const sorted = sortItems(matched, sort, dir);
	const total = sorted.length;

	const limit = Math.min(200, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const idx = sorted.findIndex((it) => it.id === params.cursor);
		start = idx === -1 ? 0 : idx + 1;
	}
	const page = sorted.slice(start, start + limit);
	const hasMore = start + limit < total;

	return {
		scope: channelId ? "channel" : "project",
		projectId: params.projectId,
		channelId,
		items: page,
		channels,
		hasMore,
		nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
		total,
		viewerId: VIEWER.id,
	};
}
// #endregion
