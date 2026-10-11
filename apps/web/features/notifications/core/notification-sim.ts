import type {
	NotificationInboxItem,
	NotificationPage,
	NotificationSummary,
} from "@projective/types/comms";
import type { DevNotifications } from "@web/utils/dev-seam.ts";
import {
	INBOX_TABS,
	type InboxCategory,
	type InboxTab,
	type InboxView,
} from "./notification-model.ts";

/**
 * notification-sim — the Dev Context Switcher's inbox (DESIGN_SYSTEM §D.9, `notifications` axis). When
 * the axis is not `auto`, {@link NotificationService} answers from here instead of the network, in the
 * API's own shapes, so the drawer and the page cannot tell the difference. Development only: the seam
 * reads `null` in production, so this module's state is never consulted there.
 */

type SimMode = Exclude<DevNotifications, "auto">;
type SimRow = NotificationInboxItem & { archivedAt: string | null };

const CATEGORIES = INBOX_TABS.filter((t): t is InboxCategory => t !== "all");

const SAMPLES: Readonly<Record<InboxCategory, readonly [string, string]>> = {
	money: ["Escrow funded", "Stage 2 escrow is held. Work can begin."],
	work: ["Submission approved", "The client approved your latest submission."],
	messages: ["New message", "“Can we hop on a quick call about the handoff?”"],
	schedule: ["Call in 15 minutes", "Kick-off with the client starts at 14:00."],
	discovery: ["New project matches your skills", "A brand identity brief was posted today."],
	account: ["New sign-in", "A new device signed in to your account."],
	system: ["Scheduled maintenance", "Projective will be read-only for ten minutes on Sunday."],
};

const MINUTE = 60_000;
/** How many arrivals a burst lands, and how far apart. */
const BURST = { count: 8, everyMs: 1_200 } as const;

let state: { mode: SimMode; rows: SimRow[] } | null = null;

function row(n: number, category: InboxCategory, at: number, unread: boolean): SimRow {
	const [title, body] = SAMPLES[category];
	const iso = new Date(at).toISOString();
	return {
		id: `00000000-0000-4000-8000-${String(900000000000 + n)}`,
		userId: "00000000-0000-4000-8000-000000000001",
		type: `${category}.simulated`,
		title: n % 3 === 0 ? `${title} (${n})` : title,
		body,
		category,
		urgency: category === "money" ? "high" : "medium",
		entityTable: null,
		entityId: null,
		contextType: null,
		contextId: null,
		actorUserId: null,
		actionUrl: category === "messages" ? "/messages" : null,
		payload: n % 2 === 0 ? { project_title: "Aurora Rebrand" } : {},
		groupKey: null,
		groupCount: n % 7 === 0 ? 4 : 1,
		channels: ["in_app"],
		readAt: unread ? null : iso,
		seenAt: unread ? null : iso,
		expiresAt: null,
		createdAt: iso,
		isUnread: unread,
		mandatory: false,
		digestible: true,
		typeDescription: null,
		actor: n % 2 === 0 ? { name: "Mara Ellison", avatar: null } : null,
		archivedAt: null,
	};
}

/** The rows a mode starts from. A burst's arrivals carry future stamps and surface as the clock passes them. */
function seed(mode: SimMode, now: number): SimRow[] {
	if (mode === "empty") return [];
	if (mode === "many") {
		return Array.from(
			{ length: 56 },
			(_, i) =>
				row(i + 1, CATEGORIES[i % CATEGORIES.length], now - (i + 1) * 47 * MINUTE, i % 5 !== 4),
		);
	}
	const settled = [1, 2, 3].map((i) => row(i, CATEGORIES[i], now - i * 90 * MINUTE, false));
	const arrivals = Array.from(
		{ length: BURST.count },
		(_, i) => row(100 + i, CATEGORIES[i % CATEGORIES.length], now + (i + 1) * BURST.everyMs, true),
	);
	return [...arrivals, ...settled];
}

/** The sim inbox for a mode, re-seeded whenever the mode changes. */
function rows(mode: SimMode): SimRow[] {
	if (state?.mode !== mode) state = { mode, rows: seed(mode, Date.now()) };
	return state.rows;
}

/** Rows that exist yet — a burst arrival is invisible until its stamp passes. */
const arrived = (mode: SimMode) => {
	const now = new Date().toISOString();
	return rows(mode).filter((r) => r.createdAt <= now);
};

function strip({ archivedAt: _, ...item }: SimRow): NotificationInboxItem {
	return item;
}

export function simSummary(mode: SimMode): NotificationSummary {
	const live = arrived(mode).filter((r) => r.archivedAt === null);
	const byCategory: NotificationSummary["byCategory"] = {};
	for (const r of live) {
		if (r.readAt === null) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
	}
	return {
		unread: live.filter((r) => r.readAt === null).length,
		unseen: live.filter((r) => r.seenAt === null).length,
		total: live.length,
		byCategory,
	};
}

export function simList(
	mode: SimMode,
	tab: InboxTab,
	view: InboxView,
	before: string | null,
	limit: number,
): NotificationPage {
	const matched = arrived(mode)
		.filter((r) =>
			(view === "archived" ? r.archivedAt !== null : r.archivedAt === null) &&
			(tab === "all" || r.category === tab) &&
			(view !== "unread" || r.readAt === null) &&
			(!before || r.createdAt < before)
		)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const items = matched.slice(0, limit).map(strip);
	return {
		items,
		summary: simSummary(mode),
		nextCursor: matched.length > limit ? items[items.length - 1].createdAt : null,
	};
}

/** The sim's state writes; each answers how many rows moved, like the RPCs. */
export function simWrite(
	mode: SimMode,
	op: "read" | "read-all" | "seen" | "archive",
	arg: { ids?: readonly string[]; category?: InboxCategory },
): number {
	const now = new Date().toISOString();
	const ids = new Set(arg.ids ?? []);
	const live = arrived(mode).filter((r) => r.archivedAt === null);
	const hit = op === "read"
		? live.filter((r) => ids.has(r.id) && r.readAt === null)
		: op === "read-all"
		? live.filter((r) => r.readAt === null && (!arg.category || r.category === arg.category))
		: op === "seen"
		? live.filter((r) => r.seenAt === null)
		: live.filter((r) => ids.has(r.id));
	for (const r of hit) {
		if (op === "archive") r.archivedAt = now;
		else if (op === "seen") r.seenAt = now;
		else {
			r.readAt = now;
			r.seenAt ??= now;
			r.isUnread = false;
		}
	}
	return hit.length;
}
