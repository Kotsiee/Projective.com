import type {
	ChatMessage,
	MessageAttachment,
	MessagePage,
	MessageSender,
} from "@projective/types/projects";
import type { ConversationSummary } from "@projective/types/messaging";
import { findConversationSummary } from "./conversation-fixtures.ts";
import { mockAvatar, mockCover } from "../../mocks/assets.ts";

/**
 * messaging message-page fixtures — the fat {@link MessagingBackendService}'s in-memory answer for the
 * message stream inside ONE conversation (`/messages/[conversationId]/chat`), while
 * `MESSAGING_BACKEND_LIVE` is off. It reuses the SAME projection as project channels
 * ({@link MessagePageSchema} / {@link ChatMessage}) — a project DM and the global inbox are one thread
 * (unified by `chatId`, PRODUCT_SPEC §Unified Messaging) — and derives a deterministic conversation from
 * the {@link ConversationSummary}'s participants so the feed agrees with the row that opened it. No RNG,
 * fixed reference clock; the same shape the ChatFeed island renders for a project channel.
 */

// #region Reference clock + deterministic helpers (mirrors projects/messages-fixtures.ts)
const NOW = Date.parse("2026-07-17T16:20:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12;
	if (h === 0) h = 12;
	return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function fmtDay(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	const d = new Date(ms);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function fakePeaks(seed: number, n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.abs(Math.sin((i + 1) * 0.7 + seed));
		const b = ((seed + i * 37) % 100) / 100;
		out.push(Math.min(1, Math.max(0.08, a * 0.65 + b * 0.35)));
	}
	return out;
}

const IMG = (id: string, w: number, h: number) => ({
	url: mockCover(id, w, h),
	w,
	h,
});
const PHOTOS = [
	IMG("photo-1618005182384-a83a8bd57fbe", 1200, 800),
	IMG("photo-1558655146-9f40138edfeb", 900, 1200),
	IMG("photo-1550684848-fac1c5b4e853", 1200, 900),
	IMG("photo-1620121692029-d088224ddc74", 1000, 1000),
];
// #endregion

// #region Participants
const VIEWER: MessageSender = {
	id: "viewer",
	name: "You",
	avatar:
		mockAvatar("photo-1531123897727-8f129e1688ce"),
	handle: "you",
};

function sendersOf(c: ConversationSummary): MessageSender[] {
	const others = c.participants.map((p): MessageSender => ({
		id: p.id,
		name: p.name,
		avatar: p.avatar,
		handle: p.handle,
	}));
	return others.length > 0 ? others : [{ id: c.id, name: c.title, avatar: c.avatar, handle: null }];
}
// #endregion

// #region Conversation script
type From = "viewer" | { other: number };
interface Beat {
	from: From;
	text?: string;
	images?: number;
	mixed?: Array<"image" | "pdf" | "zip">;
	audio?: boolean;
	reactions?: Array<[string, number, boolean]>;
	pinned?: boolean;
	favorited?: boolean;
	gapMin?: number;
}

/** The most-recent page, oldest→newest — grouping runs, media, a voice memo, reactions, a pin. */
const SHOWCASE: Beat[] = [
	{ from: { other: 0 }, text: "Hey! Great to connect here 👋", gapMin: 720 },
	{ from: { other: 0 }, text: "Sharing where we landed on the direction:", gapMin: 2 },
	{ from: { other: 0 }, images: 2, gapMin: 1 },
	{ from: "viewer", text: "Love it — the second option really sings.", gapMin: 5 },
	{ from: "viewer", text: "Could we tighten the spacing a touch?", gapMin: 1 },
	{ from: { other: 0 }, text: "Absolutely. Reworking now and I'll repost.", gapMin: 6 },
	{
		from: { other: 0 },
		text: "Here's the updated pack + source files:",
		mixed: ["image", "pdf", "zip"],
		gapMin: 40,
	},
	{ from: "viewer", audio: true, gapMin: 4 },
	{
		from: { other: 0 },
		text: "Ha — perfect, thank you!",
		reactions: [["👍", 2, true], ["🎉", 1, false]],
		gapMin: 3,
	},
	{ from: "viewer", text: "Locking this in ✅", pinned: true, favorited: true, gapMin: 2 },
	{ from: { other: 0 }, text: "🙌 onwards!", gapMin: 1 },
];

function fillerBeats(seed: number, others: number): Beat[] {
	const lines = [
		"Sounds good to me.",
		"Can you share the latest export?",
		"Just pushed the update.",
		"Nice — that reads much cleaner.",
		"Let's park that for later.",
		"Sent the brief a moment ago.",
		"Following up on the earlier note.",
		"Perfect, thanks!",
		"I'll take a proper look this afternoon.",
		"Quick one — did the invoice clear?",
	];
	const out: Beat[] = [];
	for (let i = 0; i < 32; i++) {
		const who = (seed + i) % (others + 1);
		const from: From = who === 0 ? "viewer" : { other: (who - 1) % Math.max(1, others) };
		out.push({
			from,
			text: lines[(seed + i * 7) % lines.length],
			gapMin: i % 5 === 0 ? 90 : i % 3 === 0 ? 2 : 14,
		});
	}
	return out;
}
// #endregion

// #region Builder
function attachmentsFor(beat: Beat, id: string, seed: number): MessageAttachment[] {
	const out: MessageAttachment[] = [];
	if (beat.images) {
		for (let i = 0; i < beat.images; i++) {
			const p = PHOTOS[(seed + i) % PHOTOS.length];
			out.push({
				id: `${id}-img-${i}`,
				kind: "image",
				url: p.url,
				name: `concept-${i + 1}.jpg`,
				ext: "jpg",
				width: p.w,
				height: p.h,
			});
		}
	}
	if (beat.mixed) {
		beat.mixed.forEach((kind, i) => {
			if (kind === "image") {
				const p = PHOTOS[(seed + i + 2) % PHOTOS.length];
				out.push({
					id: `${id}-mx-${i}`,
					kind: "image",
					url: p.url,
					name: `asset-${i + 1}.png`,
					ext: "png",
					width: p.w,
					height: p.h,
				});
			} else {
				out.push({
					id: `${id}-mx-${i}`,
					kind: kind === "pdf" ? "pdf" : "file",
					url: "#",
					name: kind === "pdf" ? "concept-deck.pdf" : "source-files.zip",
					ext: kind,
					width: null,
					height: null,
				});
			}
		});
	}
	return out;
}

function buildMessage(
	beat: Beat,
	index: number,
	ts: number,
	conversationId: string,
	others: MessageSender[],
	seed: number,
): ChatMessage {
	const id = `${conversationId}-m-${index}`;
	const isOwn = beat.from === "viewer";
	const sender = isOwn ? VIEWER : others[(beat.from as { other: number }).other % others.length];
	return {
		id,
		type: "user",
		createdAt: new Date(ts).toISOString(),
		timeLabel: fmtTime(ts),
		dayLabel: fmtDay(ts),
		sender,
		isOwn,
		text: beat.text ?? "",
		attachments: attachmentsFor(beat, id, seed + index),
		audio: beat.audio
			? { url: "#", durationMs: 38_000, durationLabel: "0:38", peaks: fakePeaks(seed + index, 48) }
			: null,
		system: null,
		reactions: (beat.reactions ?? []).map(([emoji, count, mine]) => ({ emoji, count, mine })),
		pinned: beat.pinned ?? false,
		favorited: beat.favorited ?? false,
	};
}

function buildPool(c: ConversationSummary): ChatMessage[] {
	const seed = hash(c.id);
	const others = sendersOf(c);
	const beats = [...fillerBeats(seed, others.length), ...SHOWCASE];

	const gaps = beats.map((b) => (b.gapMin ?? 3) * MIN);
	const totalSpan = gaps.reduce((a, g) => a + g, 0);
	let ts = NOW - totalSpan - 4 * MIN;

	return beats.map((beat, i) => {
		ts += gaps[i];
		return buildMessage(beat, i, ts, c.id, others, seed);
	});
}
// #endregion

// #region Public read
const DEFAULT_LIMIT = 28;

/** Params for a conversation message page (the load-latest + load-older cursor). */
export interface ConversationMessageParams {
	conversationId: string;
	before?: string | null;
	limit?: number;
}

/**
 * Resolve a page of messages for a conversation (the stub read path). Bottom-anchored like the project
 * channel feed: `before` unset → the latest page; `before` set → the page strictly older than that
 * message id. Returns `null` when the conversation resolves to nothing (the route maps that to a 404).
 */
export function findConversationMessagePage(params: ConversationMessageParams): MessagePage | null {
	const c = findConversationSummary(params.conversationId);
	if (!c) return null;
	if (c.messageCount === 0) {
		// An empty thread still resolves (so the composer paints) — an empty page + empty state.
		return {
			channelId: c.id,
			messages: [],
			hasMore: false,
			nextCursor: null,
			pinned: [],
			permissions: { canPin: true },
			total: 0,
		};
	}

	const pool = buildPool(c);
	const limit = Math.min(100, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	const total = pool.length;

	let endExclusive = total;
	if (params.before) {
		const idx = pool.findIndex((m) => m.id === params.before);
		endExclusive = idx === -1 ? total : idx;
	}
	const startInclusive = Math.max(0, endExclusive - limit);
	const messages = pool.slice(startInclusive, endExclusive);
	const hasMore = startInclusive > 0;
	const pinned = pool.filter((m) => m.pinned).slice(-3).reverse();

	// Anyone may pin in a DM; in a group, the viewer may (owner/admin semantics land with the backend).
	const canPin = true;

	return {
		channelId: c.id,
		messages,
		hasMore,
		nextCursor: hasMore && messages.length > 0 ? messages[0].id : null,
		pinned,
		permissions: { canPin },
		total,
	};
}
// #endregion
