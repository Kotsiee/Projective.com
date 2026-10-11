import {
	type NotificationPage,
	NotificationPageSchema,
	type NotificationSummary,
	NotificationSummarySchema,
} from "@projective/types/comms";
import { readDevSeam } from "@web/utils/dev-seam.ts";
import {
	type InboxCategory,
	type InboxTab,
	type InboxView,
	listQuery,
} from "./notification-model.ts";
import { simList, simSummary, simWrite } from "./notification-sim.ts";

/**
 * NotificationService — the THIN client for the in-app inbox (`/api/notifications/*`, served by
 * `NotificationInboxBackendService`). The drawer and `/notifications` stay dumb islands: they call
 * this, never Supabase. Reads are parsed against the `@projective/types/comms` SSOT, so a drifted
 * payload is an error state rather than a wrong row. While the Dev Context Switcher's `notifications`
 * axis is set, every call is answered by `notification-sim` instead of the network.
 */

/** A read's outcome: the data, or the server's own sentence for the error state. */
export type InboxResult<T> = { ok: true; data: T } | { ok: false; message: string };

const READ_FAILED = "We couldn't load your notifications. Try again in a moment.";
const WRITE_FAILED = "We couldn't update your notifications. Try again.";

/** The simulated mode, or `null` for the real inbox. */
function sim() {
	const mode = readDevSeam()?.notifications;
	return mode && mode !== "auto" ? mode : null;
}

async function send(path: string, body?: unknown, keepalive = false): Promise<boolean> {
	try {
		const res = await fetch(`/api/notifications/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body ?? {}),
			// A row's click navigates away at once; keepalive lets its mark-read outlive the page.
			keepalive,
		});
		return res.ok;
	} catch {
		return false;
	}
}

async function write(
	op: "read" | "read-all" | "seen" | "archive",
	body: { ids?: readonly string[]; category?: InboxCategory },
	keepalive = false,
): Promise<InboxResult<null>> {
	const mode = sim();
	if (mode) {
		simWrite(mode, op, body);
		return { ok: true, data: null };
	}
	return await send(op, body, keepalive)
		? { ok: true, data: null }
		: { ok: false, message: WRITE_FAILED };
}

export const NotificationService = {
	/** Whether the dev burst is running — the shell polls faster while it is. */
	bursting(): boolean {
		return sim() === "burst";
	},

	/** One page of a tab and view, newest first; `before` is the previous page's `nextCursor`. */
	async list(
		tab: InboxTab,
		view: InboxView,
		before: string | null = null,
		limit = 20,
	): Promise<InboxResult<NotificationPage>> {
		const mode = sim();
		if (mode) return { ok: true, data: simList(mode, tab, view, before, limit) };
		try {
			const res = await fetch(`/api/notifications?${listQuery(tab, view, before, limit)}`, {
				headers: { accept: "application/json" },
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) return { ok: false, message: body?.message ?? READ_FAILED };
			const parsed = NotificationPageSchema.safeParse(body);
			return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: READ_FAILED };
		} catch {
			return { ok: false, message: READ_FAILED };
		}
	},

	/** The badge summary, or `null` when it can't be read (chrome: the dot simply keeps its last state). */
	async summary(): Promise<NotificationSummary | null> {
		const mode = sim();
		if (mode) return simSummary(mode);
		try {
			const res = await fetch("/api/notifications/summary", {
				headers: { accept: "application/json" },
			});
			if (!res.ok) return null;
			const parsed = NotificationSummarySchema.safeParse(await res.json().catch(() => null));
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	},

	markRead: (ids: readonly string[], keepalive = false) => write("read", { ids }, keepalive),
	markAllRead: (category?: InboxCategory) => write("read-all", category ? { category } : {}),
	markSeen: () => write("seen", {}),
	archive: (ids: readonly string[]) => write("archive", { ids }),
};
