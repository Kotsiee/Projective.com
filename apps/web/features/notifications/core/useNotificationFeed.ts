import { type ReadonlySignal, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { NotificationInboxItem } from "@projective/types/comms";
import { createAnnouncer, type InboxTab, type InboxView, mergeHead } from "./notification-model.ts";
import { NotificationService } from "./NotificationService.ts";
import { inboxArrivals, inboxEpoch, publishSummary, refreshSummary } from "./notification-state.ts";

/** How the list's own read is going — distinct from whether the inbox happens to be empty. */
export type FeedPhase = "loading" | "ready" | "error";

/** Options for {@link useNotificationFeed}. */
export interface NotificationFeedOptions {
	tab: ReadonlySignal<InboxTab>;
	view: ReadonlySignal<InboxView>;
	/** Whether the list is on screen (the drawer is open; the page always is). Reads wait for it. */
	active: ReadonlySignal<boolean>;
	pageSize?: number;
}

/**
 * useNotificationFeed — one tab-and-view slice of the inbox for the drawer and the page alike: the
 * first page on open or on a tab change, keyset "load more", the live head merge on every arrival
 * pulse (announced politely, rate-limited), and optimistic read / archive / mark-all writes that roll
 * back with an error notice when the server refuses. Opening the list, and every arrival it shows,
 * marks the inbox seen — that is what turns the header dot off.
 */
export function useNotificationFeed({ tab, view, active, pageSize = 20 }: NotificationFeedOptions) {
	const items = useSignal<NotificationInboxItem[]>([]);
	const phase = useSignal<FeedPhase>("loading");
	const failure = useSignal<string | null>(null);
	const cursor = useSignal<string | null>(null);
	const loadingMore = useSignal(false);
	/** The polite live region's text. */
	const announcement = useSignal("");
	const announcer = useMemo(() => createAnnouncer((m) => (announcement.value = m)), []);
	useEffect(() => () => announcer.dispose(), []);

	// Only the newest load may land: a tab switched mid-read must not paint the old tab's rows.
	const generation = useRef(0);
	const lastPulse = useRef(inboxArrivals.peek());
	const seen = () => void NotificationService.markSeen().then(refreshSummary);

	async function load(): Promise<void> {
		const mine = ++generation.current;
		phase.value = "loading";
		const res = await NotificationService.list(tab.peek(), view.peek(), null, pageSize);
		if (mine !== generation.current) return;
		if (!res.ok) {
			failure.value = res.message;
			phase.value = "error";
			return;
		}
		items.value = res.data.items;
		cursor.value = res.data.nextCursor;
		failure.value = null;
		phase.value = "ready";
		publishSummary(res.data.summary);
		if (view.peek() !== "archived") seen();
	}

	async function loadMore(): Promise<void> {
		if (!cursor.value || loadingMore.value) return;
		loadingMore.value = true;
		const res = await NotificationService.list(tab.peek(), view.peek(), cursor.value, pageSize);
		loadingMore.value = false;
		if (!res.ok) {
			failure.value = res.message;
			return;
		}
		const known = new Set(items.value.map((i) => i.id));
		items.value = [...items.value, ...res.data.items.filter((i) => !known.has(i.id))];
		cursor.value = res.data.nextCursor;
	}

	async function refreshHead(): Promise<void> {
		const res = await NotificationService.list(tab.peek(), view.peek(), null, pageSize);
		if (!res.ok || phase.peek() !== "ready") return;
		const merged = mergeHead(items.peek(), res.data.items);
		items.value = merged.items;
		if (merged.added > 0) {
			announcer.push(merged.added);
			seen();
		}
	}

	// First page whenever the list becomes visible or its slice changes.
	useSignalEffect(() => {
		void [tab.value, view.value, inboxEpoch.value];
		if (active.value) void load();
	});

	// Arrivals: merge the head of an open live list.
	useSignalEffect(() => {
		const pulse = inboxArrivals.value;
		if (pulse === lastPulse.current) return;
		lastPulse.current = pulse;
		if (active.peek() && view.peek() !== "archived") void refreshHead();
	});

	/** Apply `patch` to the rows in `ids` locally; returns the rows as they were, for a rollback. */
	function patch(
		ids: ReadonlySet<string>,
		fn: (i: NotificationInboxItem) => NotificationInboxItem,
	) {
		const before = items.value;
		items.value = before.map((i) => (ids.has(i.id) ? fn(i) : i));
		return before;
	}

	const asRead = (i: NotificationInboxItem): NotificationInboxItem => ({
		...i,
		isUnread: false,
		readAt: i.readAt ?? new Date().toISOString(),
	});

	async function settle(before: NotificationInboxItem[], ok: boolean, message: string) {
		if (!ok) {
			items.value = before;
			failure.value = message;
		} else failure.value = null;
		await refreshSummary();
	}

	return {
		items,
		phase,
		failure,
		cursor,
		loadingMore,
		announcement,
		reload: load,
		loadMore,

		/** Mark rows read. `keepalive` for a row's own click, which navigates away at once. */
		async markRead(ids: readonly string[], keepalive = false): Promise<void> {
			const unread = ids.filter((id) => items.value.find((i) => i.id === id)?.isUnread);
			if (unread.length === 0) return;
			const before = patch(new Set(unread), asRead);
			const res = await NotificationService.markRead(unread, keepalive);
			await settle(before, res.ok, res.ok ? "" : res.message);
		},

		/** Dismiss rows; they leave the live list at once. */
		async archive(ids: readonly string[]): Promise<void> {
			if (ids.length === 0) return;
			const gone = new Set(ids);
			const before = items.value;
			items.value = before.filter((i) => !gone.has(i.id));
			const res = await NotificationService.archive(ids);
			await settle(before, res.ok, res.ok ? "" : res.message);
			if (res.ok) {
				announcement.value = ids.length === 1
					? "Notification archived."
					: `${ids.length} notifications archived.`;
			}
		},

		/** Mark everything in the current tab read — server-side, so rows beyond the loaded page move too. */
		async markAllRead(): Promise<void> {
			const t = tab.peek();
			const before = patch(new Set(items.value.map((i) => i.id)), asRead);
			const res = await NotificationService.markAllRead(t === "all" ? undefined : t);
			await settle(before, res.ok, res.ok ? "" : res.message);
			if (res.ok) announcement.value = "All marked as read.";
		},
	};
}

/** The feed handle {@link useNotificationFeed} returns. */
export type NotificationFeed = ReturnType<typeof useNotificationFeed>;
