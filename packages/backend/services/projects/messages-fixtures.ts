import type {
	ChatMessage,
	MessageAttachment,
	MessagePage,
	MessagePageParams,
	MessageSender,
	ProjectDetail,
	SystemActivityType,
} from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * projects messages fixtures — the fat {@link ProjectBackendService}'s in-memory answer for a channel's
 * conversation read (`/projects/[projectId]/[channelId]/chat`), while `PROJECTS_BACKEND_LIVE` is off
 * (thin-frontend pattern, root CLAUDE.md §10). Like {@link findProjectDetail}, it DERIVES a deterministic
 * conversation from the resolved {@link ProjectDetail} (the same members/DM party the channel tree shows)
 * so the feed always agrees with the channel that opened it, and the live path (RLS-scoped
 * `messages.*` unified by `chatId`) replaces this builder behind the same gate with zero shape churn
 * (the projection is already the SSOT {@link MessagePageSchema}). No RNG — a slug+channel hash gives
 * stable per-channel variation; a fixed reference clock keeps SSR and the island's refetch identical.
 */

// #region Reference clock + deterministic helpers
/** Fixed reference "now" (no `Date.now()`), so the pre-formatted labels + ordering are deterministic. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const MIN = 60_000;
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

/** A deterministic pseudo-waveform envelope (0..1) for an audio memo, `n` bars. */
function fakePeaks(seed: number, n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.abs(Math.sin((i + 1) * 0.7 + seed));
		const b = ((seed + i * 37) % 100) / 100;
		out.push(Math.min(1, Math.max(0.08, a * 0.65 + b * 0.35)));
	}
	return out;
}
// #endregion

// #region Media pool (Unsplash crops — open registry, §C.4)
const IMG = (id: string, w: number, h: number): { url: string; w: number; h: number } => ({
	url: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`,
	w,
	h,
});

/** A spread of aspect ratios so single-row media lays out in true proportion. */
const PHOTOS = [
	IMG("photo-1618005182384-a83a8bd57fbe", 1200, 800),
	IMG("photo-1558655146-9f40138edfeb", 900, 1200),
	IMG("photo-1550684848-fac1c5b4e853", 1200, 900),
	IMG("photo-1620121692029-d088224ddc74", 1000, 1000),
	IMG("photo-1611262588024-d12430b98920", 1200, 675),
	IMG("photo-1626785774573-4b799315345d", 800, 1000),
];
// #endregion

// #region Participants
/** The acting viewer — their messages render right-aligned with hidden metadata. */
const VIEWER: MessageSender = {
	id: "viewer",
	name: "You",
	avatar:
		"https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80",
	handle: "you",
};

/** Resolve the other participants (senders) for a channel from its project detail. */
function participantsOf(detail: ProjectDetail, channelId: string): MessageSender[] {
	// A DM channel keys off `dm-{handle}` — a 1:1 thread with that single party.
	const dm = detail.channels.dms.find((d) => d.chatId === channelId);
	if (dm) {
		return [{ id: dm.chatId, name: dm.party.name, avatar: dm.party.avatar, handle: dm.party.handle }];
	}
	// Otherwise a group channel — the non-viewer members are the cast.
	const cast = detail.members
		.map((m): MessageSender => ({
			id: m.id,
			name: m.party.name,
			avatar: m.party.avatar,
			handle: m.party.handle,
		}))
		.slice(0, 3);
	return cast.length > 0 ? cast : [{
		id: `${detail.slug}-owner`,
		name: detail.owner.name,
		avatar: detail.owner.avatar,
		handle: detail.owner.handle,
	}];
}
// #endregion

// #region Conversation script
/** A `from` reference: the viewer, an other-participant index (mod count), or a system notice. */
type From = "viewer" | { other: number } | "system";

interface Beat {
	from: From;
	text?: string;
	/** Count of single-row images. */
	images?: number;
	/** A mixed attachment set (grid; may overflow past 4 → `+N`). */
	mixed?: Array<"image" | "video" | "pdf" | "zip">;
	audio?: boolean;
	/** `actor` prepends a participant's name to `text` (system notices carry no sender). */
	system?: { type: SystemActivityType; text: string; target: string | null; actor?: number };
	reactions?: Array<[string, number, boolean]>;
	pinned?: boolean;
	favorited?: boolean;
	/** Minutes after the previous beat (default 3). Large gaps break message groups + cross days. */
	gapMin?: number;
}

/**
 * The most-recent page, oldest→newest — a showcase that exercises grouping runs, system notices, a
 * single-row image set, a mixed/overflow grid, a voice memo, reactions, pins, and a favourite. Placed
 * at the tail so it is immediately visible; older filler is generated before it for pagination depth.
 */
const SHOWCASE: Beat[] = [
	{
		from: "system",
		system: { type: "member_joined", text: "joined the channel", target: null, actor: 0 },
		gapMin: 1440,
	},
	{ from: { other: 0 }, text: "Morning! Kicking off the concepts stage 🎨", gapMin: 30 },
	{ from: { other: 0 }, text: "Pulled together a moodboard overnight — sharing the direction below.", gapMin: 2 },
	{ from: { other: 0 }, images: 3, gapMin: 1 },
	{ from: "viewer", text: "These are gorgeous. The second palette is 🔥", gapMin: 6 },
	{ from: "viewer", text: "Could we push the display type a notch bolder though?", gapMin: 1 },
	{ from: { other: 1 }, text: "Agreed. I'll rework the type scale and repost.", gapMin: 4 },
	{
		from: "system",
		system: {
			type: "submission_made",
			text: "submitted work on Concepts",
			target: "submissions/sub-concepts-2",
			actor: 1,
		},
		gapMin: 22,
	},
	{
		from: { other: 1 },
		text: "Full concept pack + the source files:",
		mixed: ["image", "image", "image", "pdf", "zip", "video"],
		gapMin: 1,
	},
	{ from: "viewer", audio: true, gapMin: 8 },
	{
		from: { other: 0 },
		text: "Ha, love the energy. Booking the review call now.",
		reactions: [["👍", 2, true], ["❤️", 1, false]],
		gapMin: 3,
	},
	{
		from: "system",
		system: { type: "ticket_created", text: "opened a ticket · Export retina assets", target: "tasks", actor: 0 },
		gapMin: 5,
	},
	{ from: "viewer", text: "Final direction locked ✅ great work everyone.", pinned: true, favorited: true, gapMin: 4 },
	{ from: { other: 2 }, text: "🙌", gapMin: 2 },
	{ from: { other: 0 }, text: "Onwards to design 🚀", gapMin: 1 },
];

/** Older filler — simple alternating text with the odd grouping run, for load-on-scroll-up depth. */
function fillerBeats(seed: number): Beat[] {
	const lines = [
		"Sounds good to me.",
		"Can you share the latest export?",
		"Just pushed the update.",
		"Nice — that reads much cleaner.",
		"Let's park that for the next stage.",
		"Sent you the brief a moment ago.",
		"Following up on the earlier note.",
		"Perfect, thanks!",
		"I'll take a proper look this afternoon.",
		"Quick one — did the invoice clear?",
	];
	const out: Beat[] = [];
	for (let i = 0; i < 40; i++) {
		const who = (seed + i) % 3;
		const from: From = who === 0 ? "viewer" : { other: who };
		out.push({
			from,
			text: lines[(seed + i * 7) % lines.length],
			// A run of two from the same author every so often (grouping), otherwise a wider gap.
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
				const p = PHOTOS[(seed + i + 3) % PHOTOS.length];
				out.push({
					id: `${id}-mx-${i}`,
					kind: "image",
					url: p.url,
					name: `asset-${i + 1}.png`,
					ext: "png",
					width: p.w,
					height: p.h,
				});
			} else if (kind === "video") {
				const p = PHOTOS[(seed + i) % PHOTOS.length];
				out.push({
					id: `${id}-mx-${i}`,
					kind: "video",
					url: p.url,
					name: "walkthrough.mp4",
					ext: "mp4",
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

/** Materialise one beat into a {@link ChatMessage}. `base` is the channel route base for system links. */
function buildMessage(
	beat: Beat,
	index: number,
	ts: number,
	channelId: string,
	base: string,
	others: MessageSender[],
	seed: number,
): ChatMessage {
	const id = `${channelId}-m-${index}`;
	const isSystem = beat.from === "system";
	const sender: MessageSender | null = isSystem
		? null
		: beat.from === "viewer"
		? VIEWER
		: others[(beat.from as { other: number }).other % others.length];
	const isOwn = beat.from === "viewer";

	// System notices carry no sender, so prepend the acting participant's name to the line.
	let systemPayload = null as ChatMessage["system"];
	if (isSystem && beat.system) {
		const actor = beat.system.actor !== undefined
			? others[beat.system.actor % others.length]?.name ?? "Someone"
			: null;
		systemPayload = {
			type: beat.system.type,
			text: actor ? `${actor} ${beat.system.text}` : beat.system.text,
			targetHref: beat.system.target ? `${base}/${beat.system.target}` : null,
		};
	}

	return {
		id,
		type: isSystem ? "system" : "user",
		createdAt: new Date(ts).toISOString(),
		timeLabel: fmtTime(ts),
		dayLabel: fmtDay(ts),
		sender,
		isOwn,
		text: beat.text ?? "",
		attachments: attachmentsFor(beat, id, seed + index),
		audio: beat.audio
			? { url: "#", durationMs: 42_000, durationLabel: "0:42", peaks: fakePeaks(seed + index, 48) }
			: null,
		system: systemPayload,
		reactions: (beat.reactions ?? []).map(([emoji, count, mine]) => ({ emoji, count, mine })),
		pinned: beat.pinned ?? false,
		favorited: beat.favorited ?? false,
	};
}

/**
 * The full ordered message pool for a channel (oldest→newest). Empty for `announcements`-style
 * broadcast channels so the empty state is demonstrable. Otherwise: older filler + the showcase tail.
 */
function buildPool(detail: ProjectDetail, channelId: string, base: string): ChatMessage[] {
	// A couple of channel ids stand in for genuinely empty channels (demonstrates the empty state).
	if (/announce|empty/i.test(channelId)) return [];

	const seed = hash(`${detail.slug}:${channelId}`);
	const others = participantsOf(detail, channelId);
	const beats = [...fillerBeats(seed), ...SHOWCASE];

	// Anchor the newest beat near NOW: sum the gaps, start that far back, then walk forward.
	const gaps = beats.map((b) => (b.gapMin ?? 3) * MIN);
	const totalSpan = gaps.reduce((a, g) => a + g, 0);
	let ts = NOW - totalSpan - 4 * MIN;

	return beats.map((beat, i) => {
		ts += gaps[i];
		return buildMessage(beat, i, ts, channelId, base, others, seed);
	});
}
// #endregion

// #region Public read
const DEFAULT_LIMIT = 28;

/**
 * Resolve a page of messages for a channel (the stub read path). Bottom-anchored: `before` unset →
 * the latest page; `before` set → the page strictly older than that message id. Returns `null` when the
 * project/channel resolves to nothing (the route maps that to a 404).
 */
export function findMessagePage(params: MessagePageParams): MessagePage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;

	const base = `/projects/${params.projectId}/${params.channelId}`;
	const pool = buildPool(detail, params.channelId, base);
	const limit = Math.min(100, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	const total = pool.length;

	// Resolve the slice end: latest page ends at the tail; an older page ends just before `before`.
	let endExclusive = total;
	if (params.before) {
		const idx = pool.findIndex((m) => m.id === params.before);
		endExclusive = idx === -1 ? total : idx;
	}
	const startInclusive = Math.max(0, endExclusive - limit);
	const messages = pool.slice(startInclusive, endExclusive);
	const hasMore = startInclusive > 0;

	// The sticky banner: pinned messages across the whole channel, most-recent first, capped at 3.
	const pinned = pool.filter((m) => m.pinned).slice(-3).reverse();

	// Pin permission: anyone in a DM; in a project/team channel only when the viewer is the client/owner.
	const isDm = detail.channels.dms.some((d) => d.chatId === params.channelId);
	const canPin = isDm || detail.viewerIsClient;

	return {
		channelId: params.channelId,
		messages,
		hasMore,
		nextCursor: hasMore && messages.length > 0 ? messages[0].id : null,
		pinned,
		permissions: { canPin },
		total,
	};
}
// #endregion
