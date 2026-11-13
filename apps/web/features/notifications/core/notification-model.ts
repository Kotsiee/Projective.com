import {
	NOTIFICATION_QUERY_MAX,
	type NotificationCategory,
	type NotificationInboxItem,
	type NotificationSummary,
} from "@projective/types/comms";
import { relativeAge } from "@features/explore/core/card-signals.ts";

/**
 * notification-model — the pure rules the header drawer, the `/notifications` lane and the page share
 * (DESIGN_SYSTEM §D.9): which categories and views exist, how a deep link decodes, what a row's meta
 * line says, how a live refresh merges into a loaded list, and how arrivals are announced without
 * flooding a screen reader.
 */

// #region Vocabulary
/** The inbox categories. Marketing has no filter: it lives only in Settings → Notifications. */
export type InboxCategory = Exclude<NotificationCategory, "marketing">;
/** A category filter: everything, or one category. */
export type InboxTab = "all" | InboxCategory;
/** The status views. The drawer offers `all` and `unread`; the page adds `archived`. */
export type InboxView = "all" | "unread" | "archived";

/** What a `/notifications` URL addresses: the category, the status view and the search. */
export interface InboxFilter {
	tab: InboxTab;
	view: InboxView;
	/** The trimmed search, `""` for none. */
	query: string;
}

export const DEFAULT_INBOX_FILTER: Readonly<InboxFilter> = { tab: "all", view: "all", query: "" };

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
	all: "All categories",
	money: "Money",
	work: "Work",
	messages: "Messages",
	schedule: "Schedule",
	discovery: "Discovery",
	account: "Account",
	system: "System",
};

export const INBOX_VIEWS: readonly InboxView[] = ["all", "unread", "archived"];

/** The drawer's status filter: it never shows the archive, which is the page's. */
export const DRAWER_VIEWS: readonly InboxView[] = ["all", "unread"];

export const VIEW_LABEL: Readonly<Record<InboxView, string>> = {
	all: "All",
	unread: "Unread",
	archived: "Archived",
};

/** The lane's row names, which stand without a control around them. */
export const VIEW_LANE_LABEL: Readonly<Record<InboxView, string>> = {
	all: "All notifications",
	unread: "Unread",
	archived: "Archived",
};

/** How long typing rests before a search is applied. */
export const SEARCH_DEBOUNCE_MS = 250;

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

/** `?q=` → the search: trimmed, and cut to the length the list endpoint accepts. */
export function parseQuery(raw: string | null | undefined): string {
	return (raw ?? "").trim().slice(0, NOTIFICATION_QUERY_MAX);
}

/** A `/notifications` query string → the filter it addresses. */
export function parseFilter(params: URLSearchParams): InboxFilter {
	return {
		tab: parseTab(params.get("category")),
		view: parseView(params.get("view")),
		query: parseQuery(params.get("q")),
	};
}

/** The page's own address for a filter — defaults are omitted so the bare URL stays canonical. */
export function inboxHref(tab: InboxTab, view: InboxView, query = ""): string {
	const q = new URLSearchParams();
	if (tab !== "all") q.set("category", tab);
	if (view !== "all") q.set("view", view);
	if (query) q.set("q", query);
	const s = q.toString();
	return s ? `/notifications?${s}` : "/notifications";
}

/** The list endpoint's query for a filter slice and cursor. */
export function listQuery(
	tab: InboxTab,
	view: InboxView,
	before?: string | null,
	limit = 20,
	query = "",
): string {
	const q = new URLSearchParams({ limit: String(limit) });
	if (tab !== "all") q.set("category", tab);
	if (view === "unread") q.set("unreadOnly", "true");
	if (view === "archived") q.set("archived", "true");
	if (query) q.set("q", query);
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

/** A count as a lane or option prints it: capped at `99+`. */
export function countLabel(n: number): string {
	return n > 99 ? "99+" : String(n);
}

/** The row's category as words; an in-app marketing row reads as the platform's own. */
export function categoryLabel(item: NotificationInboxItem): string {
	return item.category === "marketing" ? "Projective" : TAB_LABEL[item.category];
}

/** The project, stage or entity the payload names, or `null` when it names none. */
export function contextLabel(item: NotificationInboxItem): string | null {
	for (const key of ["project_title", "stage_name", "entity_name"]) {
		const value = item.payload[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

/** A collapsed row's count, or `null` for a single event. */
export function groupNote(item: NotificationInboxItem): string | null {
	return item.groupCount > 1 ? `${item.groupCount} updates` : null;
}

/** The inline meta line: `Work · Brand system · 3h ago · 3 updates`. */
export function metaLine(item: NotificationInboxItem, now: number): string {
	const age = relativeAge(item.createdAt, now);
	return [categoryLabel(item), contextLabel(item), age ? `${age} ago` : "Just now", groupNote(item)]
		.filter(Boolean).join(" · ");
}

/** The empty state's sentence for a filter. */
export function emptyCopy(
	tab: InboxTab,
	view: InboxView,
	query = "",
): { title: string; description: string } {
	if (query) {
		return {
			title: `Nothing matches “${query}”`,
			description: "Try another word, or clear the search.",
		};
	}
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
