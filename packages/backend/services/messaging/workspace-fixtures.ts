import type {
	ChatMessage,
	FileChannelRef,
	FileItem,
	FileKind,
	FileListPage,
	FileListParams,
	FileSortDir,
	FileSortKey,
	MemberRole,
	MemberRosterPage,
	MemberViewerCaps,
	ProjectMemberRow,
} from "@projective/types/projects";
import { categorizeFile } from "@projective/types/files";
import type { ConversationDetail } from "@projective/types/messaging";
import { findConversationDetail } from "./conversation-fixtures.ts";
import { findConversationMessagePage } from "./messages-fixtures.ts";

/**
 * messaging workspace fixtures — the conversation-scoped **Files** and **Members** projections.
 *
 * These deliberately return the SAME shapes the engagement surfaces use
 * ({@link FileListPage} / {@link MemberRosterPage}, the Zod SSOT in `@projective/types/projects`), so
 * `/messages/[conversationId]/{files,members}` mounts the very same `FileExplorer` and `MemberRoster`
 * islands as `/projects/[projectId]/[channelId]/{files,members}` — one component tree, one behaviour
 * (zoom-driven grid⇄list, virtualization, the preview modal; the roster table, avatar stacks, role
 * tags), rather than two lookalike implementations that drift.
 *
 * Both are DERIVED deterministically from the existing conversation fixtures (no RNG, the same fixed
 * reference clock as {@link findConversationMessagePage}), so a file row always agrees with the message
 * that carried it and a roster row with the conversation header. **No DB migration** — like the sibling
 * `detail`/`messages` reads, this is a read projection over the eventual `messages.*` tables.
 *
 * A conversation has no stages and no invitation queue, so those slices of the roster projection come
 * back empty; the roster island already renders that state (a DM is simply a two-row roster).
 */

// #region Files
/** Enough of a message page to enumerate its attachments. */
type Attachment = ChatMessage["attachments"][number];

/** The audio "attachment" a voice note contributes to the file list. */
const AUDIO_EXT = "m4a";

/** Rough byte estimate per kind so the size column + sort are stable and plausible. */
const BYTES_PER_KIND: Record<string, number> = {
	image: 1_400_000,
	video: 18_000_000,
	audio: 900_000,
	pdf: 2_200_000,
	doc: 480_000,
	code: 24_000,
	archive: 8_400_000,
	file: 320_000,
};

function hash(s: string): number {
	let h = 0;
	// Unsigned shift — a signed `>>` would go negative and produce an out-of-range index.
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** A stable, plausible byte size for an attachment (deterministic; ±40% around the kind's base). */
function sizeOf(kind: string, seed: string): number {
	const base = BYTES_PER_KIND[kind] ?? BYTES_PER_KIND.file;
	const jitter = (hash(seed) % 80) / 100 - 0.4; // -0.40 … +0.39
	return Math.max(1024, Math.round(base * (1 + jitter)));
}

function sizeLabel(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
	return `${bytes} B`;
}

/** Map the lean chat-attachment kind onto the explorer's richer {@link FileKind}. */
function fileKindOf(a: Attachment): FileKind {
	switch (a.kind) {
		case "image":
			return "image";
		case "video":
			return "video";
		case "pdf":
			return "pdf";
		default:
			return extKind(a.ext);
	}
}

/** Fall back to the extension when the chat attachment only says "file". */
function extKind(ext: string): FileKind {
	const e = ext.toLowerCase();
	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(e)) return "image";
	if (["mp4", "mov", "webm", "mkv"].includes(e)) return "video";
	if (["mp3", "wav", "m4a", "ogg", "flac"].includes(e)) return "audio";
	if (e === "pdf") return "pdf";
	if (
		["doc", "docx", "txt", "md", "rtf", "pages", "key", "ppt", "pptx", "xls", "xlsx"].includes(e)
	) {
		return "doc";
	}
	if (["ts", "tsx", "js", "jsx", "json", "css", "html", "py", "rs", "go", "sh"].includes(e)) {
		return "code";
	}
	if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "archive";
	return "file";
}

/**
 * Flatten a conversation's message stream into explorer file rows — every image/video/document
 * attachment plus every voice note, newest first, each carrying the provenance the preview modal shows
 * (the message it came from, its text, its sender, its timestamps).
 */
function filesOf(detail: ConversationDetail): FileItem[] {
	const page = findConversationMessagePage({ conversationId: detail.id, limit: 100 });
	if (!page) return [];

	const rows: FileItem[] = [];
	for (const m of page.messages) {
		const sender = m.sender ??
			{ id: "viewer", name: "You", avatar: null, handle: null, roleLabel: null };

		for (const a of m.attachments) {
			const kind = fileKindOf(a);
			const bytes = sizeOf(kind, `${m.id}-${a.id}`);
			rows.push({
				id: `${m.id}-${a.id}`,
				kind,
				category: categorizeFile(a.name),
				name: a.name,
				ext: a.ext,
				url: a.url,
				thumbnailUrl: kind === "image" || kind === "video" ? a.url : null,
				sizeBytes: bytes,
				sizeLabel: sizeLabel(bytes),
				width: a.width ?? null,
				height: a.height ?? null,
				durationLabel: null,
				channelId: detail.id,
				channelName: detail.title,
				channelKind: "general",
				messageId: m.id,
				messageText: m.text ?? "",
				messageAudioUrl: m.audio?.url ?? null,
				sender,
				createdAt: m.createdAt,
				timeLabel: m.timeLabel,
				dayLabel: m.dayLabel,
				dateLabel: `${m.dayLabel} · ${m.timeLabel}`,
				starred: false,
			});
		}

		// A voice note is a first-class file in the explorer (the audio branch plays it inline).
		if (m.audio) {
			const bytes = sizeOf("audio", `${m.id}-voice`);
			rows.push({
				id: `${m.id}-voice`,
				kind: "audio",
				category: categorizeFile(`x.${AUDIO_EXT}`),
				name: `Voice note — ${m.dayLabel} ${m.timeLabel}.${AUDIO_EXT}`,
				ext: AUDIO_EXT,
				url: m.audio.url,
				thumbnailUrl: null,
				sizeBytes: bytes,
				sizeLabel: sizeLabel(bytes),
				width: null,
				height: null,
				durationLabel: m.audio.durationLabel ?? null,
				channelId: detail.id,
				channelName: detail.title,
				channelKind: "general",
				messageId: m.id,
				messageText: m.text ?? "",
				messageAudioUrl: m.audio.url,
				sender,
				createdAt: m.createdAt,
				timeLabel: m.timeLabel,
				dayLabel: m.dayLabel,
				dateLabel: `${m.dayLabel} · ${m.timeLabel}`,
				starred: false,
			});
		}
	}
	return rows;
}

/** Order rows by the requested key (default: newest first), matching the projects explorer. */
function sortFiles(rows: FileItem[], key: FileSortKey, dir: FileSortDir): FileItem[] {
	const sign = dir === "asc" ? 1 : -1;
	const cmp: Record<FileSortKey, (a: FileItem, b: FileItem) => number> = {
		name: (a, b) => a.name.localeCompare(b.name),
		date: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
		size: (a, b) => a.sizeBytes - b.sizeBytes,
		sender: (a, b) => a.sender.name.localeCompare(b.sender.name),
		type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
	};
	return [...rows].sort((a, b) => sign * cmp[key](a, b));
}

/**
 * The conversation-scoped file page. `params.projectId` carries the conversation id (the params shape
 * is shared across all three scopes); sort/filter/search/paging behave exactly as in the engagement
 * scopes so the island's refinement path is unchanged.
 */
export function findConversationFilePage(params: FileListParams): FileListPage | null {
	const conversationId = params.channelId || params.projectId;
	const detail = findConversationDetail(conversationId);
	if (!detail) return null;

	const all = filesOf(detail);

	const kinds = params.kinds && params.kinds.length > 0 ? new Set(params.kinds) : null;
	const q = params.query?.trim().toLowerCase();
	const matched = all.filter((f) =>
		(!kinds || kinds.has(f.kind)) &&
		(!q || f.name.toLowerCase().includes(q) || f.sender.name.toLowerCase().includes(q))
	);

	const sorted = sortFiles(matched, params.sort ?? "date", params.dir ?? "desc");
	const limit = Math.min(200, Math.max(1, params.limit ?? 60));
	const start = params.cursor ? sorted.findIndex((f) => f.id === params.cursor) + 1 : 0;
	const items = sorted.slice(start, start + limit);
	const hasMore = start + limit < sorted.length;

	const channel: FileChannelRef = {
		id: detail.id,
		name: detail.title,
		kind: "general",
		count: all.length,
	};

	return {
		scope: "conversation",
		projectId: detail.id,
		channelId: detail.id,
		items,
		channels: [channel],
		hasMore,
		nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
		total: sorted.length,
		viewerId: "viewer",
	};
}
// #endregion

// #region Members
/**
 * A conversation has no management surface: there are no roles to change, no stages to assign, and no
 * one to revoke — the only membership action is ADDING people, and that runs through the contact
 * picker (the header kebab's "Add members", which converts a DM into a group) rather than the
 * engagement's email-based invitation queue. So every capability is off, and the shared roster renders
 * its read-only presentation.
 */
function capsFor(_detail: ConversationDetail): MemberViewerCaps {
	return {
		canManage: false,
		canInvite: false,
		canAssign: false,
		canEditRoles: false,
		canRemove: false,
	};
}

/** Map a conversation participant's free-text role label onto the roster's {@link MemberRole} enum. */
function roleOf(label: string | null): MemberRole {
	const l = (label ?? "").toLowerCase();
	if (l.includes("client")) return "client";
	if (l.includes("owner")) return "owner";
	if (l.includes("admin")) return "admin";
	if (l.includes("manager")) return "manager";
	if (l.includes("freelancer")) return "freelancer";
	if (l.includes("guest")) return "guest";
	return "member";
}

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The shared reference clock (matches `messages-fixtures.ts`) so SSR and a refetch agree. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;

function joinedLabel(ms: number): string {
	const d = new Date(ms);
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The conversation-scoped roster page. Derived from the conversation's participants: the acting viewer
 * leads, then each party with their presence, role tag, and a deterministic join date. A conversation
 * has no stages and no pending invitations, so both arrays are empty.
 */
export function findConversationRoster(conversationId: string): MemberRosterPage | null {
	const detail = findConversationDetail(conversationId);
	if (!detail) return null;

	const viewerRow: ProjectMemberRow = {
		id: "viewer",
		party: { name: "You", handle: null, avatar: null },
		email: "",
		role: "member",
		assignment: null,
		presence: "online",
		assignedStages: [],
		openTickets: 0,
		ticketsLabel: "—",
		joinedAt: new Date(NOW - 120 * DAY).toISOString(),
		joinedLabel: joinedLabel(NOW - 120 * DAY),
		isViewer: true,
	};

	const rows: ProjectMemberRow[] = [
		viewerRow,
		...detail.participants.map((p): ProjectMemberRow => {
			// Deterministic tenure so the "joined" column sorts stably across SSR and a refetch.
			const joinedMs = NOW - (30 + (hash(`${detail.id}:${p.id}`) % 300)) * DAY;
			return {
				id: p.id,
				party: { name: p.name, handle: p.handle, avatar: p.avatar },
				email: p.handle ? `${p.handle}@projective.example` : "",
				role: roleOf(p.roleLabel),
				assignment: null,
				presence: p.online ? "online" : "offline",
				assignedStages: [],
				openTickets: 0,
				ticketsLabel: "—",
				joinedAt: new Date(joinedMs).toISOString(),
				joinedLabel: joinedLabel(joinedMs),
				isViewer: false,
			};
		}),
	];

	return {
		scope: "conversation",
		projectId: detail.id,
		channelId: detail.id,
		channelName: detail.title,
		channelKind: "general",
		projectTitle: detail.title,
		format: "one_off",
		members: rows,
		invites: [],
		stages: [],
		viewerId: "viewer",
		viewerRole: "member",
		viewerCaps: capsFor(detail),
		total: rows.length,
	};
}
// #endregion
