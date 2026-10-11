import type {
	NotificationCategory,
	NotificationInboxItem,
	NotificationSummary,
} from "@projective/types/comms";
import { relativeAge } from "@features/explore/core/card-signals.ts";

/**
 * notification-model — the pure rules the header drawer and `/notifications` share (DESIGN_SYSTEM
 * §D.9): which tabs exist, how a deep link decodes, what a row's meta line says, how a live refresh
 * merges into a loaded list, and how arrivals are announced without flooding a screen reader.
 */

// #region Vocabulary
/** The inbox categories. Marketing has no tab: it lives only in Settings → Notifications. */
export type InboxCategory = Exclude<NotificationCategory, "marketing">;
/** A tab: everything, or one category. */
export type InboxTab = "all" | InboxCategory;
/** The page's views. The drawer always shows `all` (live rows, read and unread). */
export type InboxView = "all" | "unread" | "archived";

export const INBOX_TABS: readonly InboxTab[] = [
	"all",
	"money",
	"work",
	"messages",
	"schedule",
	"discovery",
	"account",
	"system",
];

export const TAB_LABEL: Readonly<Record<InboxTab, string>> = {
	all: "All",
	money: "Money",
	work: "Work",
	messages: "Messages",
	schedule: "Schedule",
	discovery: "Discovery",
	account: "Account",
	system: "System",
};

export const INBOX_VIEWS: readonly InboxView[] = ["all", "unread", "archived"];

export const VIEW_LABEL: Readonly<Record<InboxView, string>> = {
	all: "All",
	unread: "Unread",
	archived: "Archived",
};

/** How often the shell re-reads `/summary` while the page is visible (Decision #173). */
export const POLL_MS = 30_000;
/** The cadence while the Dev Context Switcher's realtime burst runs. */
export const BURST_POLL_MS = 1_000;
/** The quietest gap between two arrival announcements; arrivals inside it are summed. */
export const ANNOUNCE_GAP_MS = 8_000;
// #endregion

// #region Deep links
/** `?category=` → a tab; anything unknown (or `marketing`) is All. */
export function parseTab(raw: string | null | undefined): InboxTab {
	return (INBOX_TABS as readonly string[]).includes(raw ?? "") ? raw as InboxTab : "all";
}

/** `?view=` → a view; anything unknown is All. */
export function parseView(raw: string | null | undefined): InboxView {
	return (INBOX_VIEWS as readonly string[]).includes(raw ?? "") ? raw as InboxView : "all";
}

/** The page's own address for a tab and view — defaults are omitted so the bare URL stays canonical. */
export function inboxHref(tab: InboxTab, view: InboxView): string {
	const q = new URLSearchParams();
	if (tab !== "all") q.set("category", tab);
	if (view !== "all") q.set("view", view);
	const s = q.toString();
	return s ? `/notifications?${s}` : "/notifications";
}

/** The list endpoint's query for a tab, view and cursor. */
export function listQuery(
	tab: InboxTab,
	view: InboxView,
	before?: string | null,
	limit = 20,
): string {
	const q = new URLSearchParams({ limit: String(limit) });
	if (tab !== "all") q.set("category", tab);
	if (view === "unread") q.set("unreadOnly", "true");
	if (view === "archived") q.set("archived", "true");
	if (before) q.set("before", before);
	return q.toString();
}
// #endregion

// #region Rows
/** Unread in one tab — `byCategory` is sparse, so an absent category is zero. */
export function tabUnread(summary: NotificationSummary | null, tab: InboxTab): number {
	if (!summary) return 0;
	return tab === "all" ? summary.unread : summary.byCategory[tab] ?? 0;
}

/** What the event belongs to: the project or stage named in the payload, else its category. */
export function contextLabel(item: NotificationInboxItem): string {
	for (const key of ["project_title", "stage_name", "entity_name"]) {
		const value = item.payload[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return item.category === "marketing" ? "Projective" : TAB_LABEL[item.category];
}

/** A collapsed row's count, or `null` for a single event. */
export function groupNote(item: NotificationInboxItem): string | null {
	return item.groupCount > 1 ? `${item.groupCount} updates` : null;
}

/** The inline meta line: `3h ago · Brand system · 3 updates`. */
export function metaLine(item: NotificationInboxItem, now: number): string {
	const age = relativeAge(item.createdAt, now);
	return [age ? `${age} ago` : "Just now", contextLabel(item), groupNote(item)]
		.filter(Boolean).join(" · ");
}
/** The empty state's sentence for a tab and view. */
export function emptyCopy(tab: InboxTab, view: InboxView): { title: string; description: string } {
	const scope = tab === "all" ? "" : ` in ${TAB_LABEL[tab]}`;
	if (view === "archived") {
		return {
			title: `Nothing archived${scope}`,
			description: "Archived notifications are kept here.",
		};
	}
	if (view === "unread") {
		return { title: `Nothing unread${scope}`, description: "You're all caught up." };
	}
	return {
		title: tab === "all"
			? "No notifications yet"
			: `No ${TAB_LABEL[tab].toLowerCase()} notifications`,
		description: "Updates about your work, money and messages will appear here.",
	};
}
// #endregion

// #region Live merge
/**
 * Fold a fresh first page into a loaded list: rows the list does not hold yet and that are newer than
 * its head go on top, and rows it already holds take their fresh state. Older unknown rows are left
 * to "Load more", so a refresh never reorders what the reader is looking at.
 */
export function mergeHead(
	current: readonly NotificationInboxItem[],
	fresh: readonly NotificationInboxItem[],
): { items: NotificationInboxItem[]; added: number } {
	const head = current[0]?.createdAt ?? "";
	const byId = new Map(fresh.map((i) => [i.id, i]));
	const known = new Set(current.map((i) => i.id));
	const arrivals = fresh.filter((i) => !known.has(i.id) && i.createdAt > head);
	return {
		items: [...arrivals, ...current.map((i) => byId.get(i.id) ?? i)],
		added: arrivals.length,
	};
}

/** Whether a newer summary means something arrived (archive and read only ever lower these). */
export function hasArrivals(prev: NotificationSummary | null, next: NotificationSummary): boolean {
	return prev !== null && (next.total > prev.total || next.unseen > prev.unseen);
}

/** The polite announcement for `n` arrivals. */
export function arrivalMessage(n: number): string {
	return n === 1 ? "1 new notification" : `${n} new notifications`;
}

/**
 * A rate-limited announcer: the first arrival speaks at once, arrivals inside the next `gapMs` are
 * summed and spoken once when the gap ends — a burst of ten events is two announcements, not ten.
 */
export function createAnnouncer(
	say: (message: string) => void,
	gapMs = ANNOUNCE_GAP_MS,
	clock: () => number = Date.now,
): { push(n: number): void; dispose(): void } {
	let last = -Infinity;
	let pending = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		timer = undefined;
		if (pending > 0) say(arrivalMessage(pending));
		pending = 0;
		last = clock();
	};
	return {
		push(n) {
			if (n <= 0) return;
			pending += n;
			if (timer !== undefined) return;
			const wait = last + gapMs - clock();
			if (wait <= 0) flush();
			else timer = setTimeout(flush, wait);
		},
		dispose() {
			if (timer !== undefined) clearTimeout(timer);
		},
	};
}
// #endregion
