import type { SupabaseClient } from "supabaseClient";
import type {
	NotificationCategory,
	NotificationFeedItem,
	NotificationInboxItem,
	NotificationListParams,
	NotificationPage,
	NotificationSummary,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { fetchPartyCards } from "../profile/party-cards.ts";
import { NOTIFICATION_FIXTURES } from "./notification-fixtures.ts";

/**
 * NotificationInboxBackendService — the FAT service behind `/api/notifications/*`, the in-app inbox.
 *
 * Reads `comms.notification_feed` and `comms.get_notification_summary()`; writes only through the
 * inbox RPCs (`mark_notifications_read`, `mark_all_notifications_read`, `mark_notifications_seen`,
 * `archive_notifications`). Everything runs under the caller's JWT: the own-row SELECT policy and the
 * column-scoped UPDATE grant (00002520 §2) are the boundary, so a caller can only ever move the three
 * state stamps on their own rows. Gated like its sibling {@link NotificationCenterBackendService} on
 * `AUTH_BACKEND_LIVE`; with the gate off (`deno task dev:mock`) it serves
 * {@link NOTIFICATION_FIXTURES} with per-user in-memory state, in the same shapes.
 */

// #region Live mapping
const BASE_COLUMNS =
	"id, user_id, type, title, body, category, urgency, entity_table, entity_id, context_type, context_id, actor_user_id, action_url, payload, group_key, group_count, channels, read_at, seen_at, expires_at, created_at";
const FEED_COLUMNS = `${BASE_COLUMNS}, is_unread, mandatory, digestible, type_description`;

const DEFAULT_LIMIT = 30;

function commsDb(accessToken: string): SupabaseClient {
	return getUserClient(accessToken).schema("comms") as unknown as SupabaseClient;
}

// deno-lint-ignore no-explicit-any
function toFeedItem(r: any): NotificationFeedItem {
	return {
		id: r.id,
		userId: r.user_id,
		type: r.type,
		title: r.title,
		body: r.body,
		category: r.category,
		urgency: r.urgency,
		entityTable: r.entity_table,
		entityId: r.entity_id,
		contextType: r.context_type,
		contextId: r.context_id,
		actorUserId: r.actor_user_id,
		actionUrl: r.action_url,
		payload: r.payload ?? {},
		groupKey: r.group_key,
		groupCount: r.group_count,
		channels: r.channels ?? [],
		readAt: r.read_at,
		seenAt: r.seen_at,
		expiresAt: r.expires_at,
		createdAt: r.created_at,
		// The Archived view reads the base table, which has no derived columns.
		isUnread: r.is_unread ?? r.read_at === null,
		mandatory: r.mandatory ?? null,
		digestible: r.digestible ?? null,
		typeDescription: r.type_description ?? null,
	};
}

// deno-lint-ignore no-explicit-any
function toSummary(j: any): NotificationSummary {
	return {
		unread: Number(j?.unread ?? 0),
		unseen: Number(j?.unseen ?? 0),
		total: Number(j?.total ?? 0),
		byCategory: j?.by_category ?? {},
	};
}
// #endregion

// #region Fixture state
type FixtureRow = NotificationInboxItem & { archivedAt: string | null };

/** shortcut: process-local and lost on restart, which is all dev:mock needs. */
const fixtureInboxes = new Map<string, FixtureRow[]>();

function fixtureInbox(userId: string): FixtureRow[] {
	let rows = fixtureInboxes.get(userId);
	if (!rows) {
		rows = NOTIFICATION_FIXTURES.map((n) => ({ ...n, userId, archivedAt: null }));
		fixtureInboxes.set(userId, rows);
	}
	return rows;
}

/** The feed view's filter: live rows only. */
const live = (rows: FixtureRow[]) => rows.filter((r) => r.archivedAt === null);

function fixtureSummary(rows: FixtureRow[]): NotificationSummary {
	const feed = live(rows);
	const byCategory: Partial<Record<NotificationCategory, number>> = {};
	for (const r of feed) {
		if (r.readAt === null) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
	}
	return {
		unread: feed.filter((r) => r.readAt === null).length,
		unseen: feed.filter((r) => r.seenAt === null).length,
		total: feed.length,
		byCategory,
	};
}

/** Apply `patch` to the rows `match` selects; the count of rows that changed. */
function stamp(
	rows: FixtureRow[],
	match: (r: FixtureRow) => boolean,
	patch: (r: FixtureRow) => void,
) {
	const hit = rows.filter(match);
	hit.forEach(patch);
	return hit.length;
}

function withoutArchived(row: FixtureRow): NotificationInboxItem {
	const { archivedAt: _, ...item } = row;
	return item;
}
// #endregion

/** `{ updated }` — how many rows a state write actually moved. */
export interface InboxWriteResult {
	updated: number;
}

export class NotificationInboxBackendService {
	/**
	 * One page of the caller's inbox, newest first, plus the badge summary. Filters: `category`,
	 * `contextType` / `contextId`, `unreadOnly`, or `archived` for the dismissed rows instead. Keyset
	 * paging on `created_at` via `before`; `nextCursor` is `null` on the last page. Each row carries
	 * its actor's party card (`null` for the platform, or when the card read fails).
	 */
	static async list(
		params: NotificationListParams,
		actor: ReadActor,
	): Promise<ServiceResult<NotificationPage>> {
		const guard = NotificationInboxBackendService.guard(actor);
		if (guard) return guard;
		if (params.before && Number.isNaN(Date.parse(params.before))) {
			return fail(422, {
				message: "That page cursor is not a timestamp.",
				errors: { before: "invalid" },
			});
		}
		const limit = params.limit ?? DEFAULT_LIMIT;

		if (!isAuthBackendLive()) {
			const rows = fixtureInbox(actor.userId);
			const before = params.before ? Date.parse(params.before) : Infinity;
			const pool = params.archived ? rows.filter((r) => r.archivedAt !== null) : live(rows);
			const matched = pool.filter((r) =>
				(!params.category || r.category === params.category) &&
				(!params.contextType || r.contextType === params.contextType) &&
				(!params.contextId || r.contextId === params.contextId) &&
				(params.archived || !params.unreadOnly || r.readAt === null) &&
				Date.parse(r.createdAt) < before
			).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			const items = matched.slice(0, limit).map(withoutArchived);
			return ok({
				items,
				summary: fixtureSummary(rows),
				nextCursor: matched.length > limit ? items[items.length - 1].createdAt : null,
			});
		}

		try {
			const db = commsDb(actor.accessToken!);
			// shortcut: a created_at-only cursor can skip a row that shares its microsecond with the
			// page's last row; upgrade to a (created_at, id) cursor if that ever shows up.
			// The feed view hides archived rows, so the Archived view reads the base table (same
			// own-row SELECT policy) with the view's in-app filter restated.
			let query = (params.archived
				? db.from("notifications").select(BASE_COLUMNS)
					.not("archived_at", "is", null)
					.contains("channels", ["in_app"])
				: db.from("notification_feed").select(FEED_COLUMNS))
				.eq("user_id", actor.userId)
				.order("created_at", { ascending: false })
				.order("id", { ascending: false })
				.limit(limit + 1);
			if (params.category) query = query.eq("category", params.category);
			if (params.contextType) query = query.eq("context_type", params.contextType);
			if (params.contextId) query = query.eq("context_id", params.contextId);
			if (params.unreadOnly && !params.archived) query = query.is("read_at", null);
			if (params.before) query = query.lt("created_at", params.before);

			const [page, summary] = await Promise.all([query, db.rpc("get_notification_summary")]);
			if (page.error || summary.error) {
				return fail(502, { message: "We couldn't load your notifications." });
			}
			const rows = (page.data ?? []) as unknown[];
			const feed = rows.slice(0, limit).map(toFeedItem);
			const cards = await fetchPartyCards(
				getUserClient(actor.accessToken!),
				feed.map((i) => i.actorUserId),
			);
			const items: NotificationInboxItem[] = feed.map((i) => {
				const card = i.actorUserId ? cards.get(i.actorUserId) : undefined;
				return { ...i, actor: card ? { name: card.name, avatar: card.avatar } : null };
			});
			return ok({
				items,
				summary: toSummary(summary.data),
				nextCursor: rows.length > limit ? items[items.length - 1].createdAt : null,
			});
		} catch {
			return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
		}
	}

	/** The shell badge: unread / unseen / total, and unread per category (absent = zero). */
	static async summary(actor: ReadActor): Promise<ServiceResult<NotificationSummary>> {
		const guard = NotificationInboxBackendService.guard(actor);
		if (guard) return guard;
		if (!isAuthBackendLive()) return ok(fixtureSummary(fixtureInbox(actor.userId)));
		try {
			const { data, error } = await commsDb(actor.accessToken!).rpc("get_notification_summary");
			if (error) return fail(502, { message: "We couldn't load your notification count." });
			return ok(toSummary(data));
		} catch {
			return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
		}
	}

	/** Mark specific notifications read (also seen). Rows already read, or not the caller's, are skipped. */
	static markRead(ids: string[], actor: ReadActor): Promise<ServiceResult<InboxWriteResult>> {
		const set = new Set(ids);
		return NotificationInboxBackendService.write(
			actor,
			"mark_notifications_read",
			{ p_ids: ids },
			(rows) => {
				const now = new Date().toISOString();
				return stamp(rows, (r) => set.has(r.id) && r.readAt === null, (r) => {
					r.readAt = now;
					r.seenAt ??= now;
					r.isUnread = false;
				});
			},
		);
	}

	/** Mark every live notification read, or only those in `category`. */
	static markAllRead(
		category: NotificationCategory | undefined,
		actor: ReadActor,
	): Promise<ServiceResult<InboxWriteResult>> {
		return NotificationInboxBackendService.write(
			actor,
			"mark_all_notifications_read",
			{ p_category: category ?? null },
			(rows) => {
				const now = new Date().toISOString();
				return stamp(
					live(rows),
					(r) => r.readAt === null && (!category || r.category === category),
					(r) => {
						r.readAt = now;
						r.seenAt ??= now;
						r.isUnread = false;
					},
				);
			},
		);
	}

	/** Clear the badge (opening the drawer) without marking anything read. */
	static markSeen(actor: ReadActor): Promise<ServiceResult<InboxWriteResult>> {
		return NotificationInboxBackendService.write(actor, "mark_notifications_seen", {}, (rows) => {
			const now = new Date().toISOString();
			return stamp(live(rows), (r) => r.seenAt === null, (r) => {
				r.seenAt = now;
			});
		});
	}

	/** Dismiss = archive; nothing is hard-deleted. */
	static archive(ids: string[], actor: ReadActor): Promise<ServiceResult<InboxWriteResult>> {
		const set = new Set(ids);
		return NotificationInboxBackendService.write(
			actor,
			"archive_notifications",
			{ p_ids: ids },
			(rows) => {
				const now = new Date().toISOString();
				return stamp(rows, (r) => set.has(r.id) && r.archivedAt === null, (r) => {
					r.archivedAt = now;
				});
			},
		);
	}

	// #region Internals
	/** 401 for a guest, or for a live backend with no token to bind RLS to. */
	private static guard(actor: ReadActor): ServiceResult<never> | null {
		if (!actor.userId) return fail(401, { message: "Sign in to see your notifications." });
		if (isAuthBackendLive() && !canReadLive(actor)) {
			return fail(401, { message: "Your session has expired. Please sign in again." });
		}
		return null;
	}

	/** One inbox RPC live, or its fixture equivalent; both answer the count of rows moved. */
	private static async write(
		actor: ReadActor,
		rpc: string,
		args: Record<string, unknown>,
		fixture: (rows: FixtureRow[]) => number,
	): Promise<ServiceResult<InboxWriteResult>> {
		const guard = NotificationInboxBackendService.guard(actor);
		if (guard) return guard;
		if (!isAuthBackendLive()) return ok({ updated: fixture(fixtureInbox(actor.userId)) });
		try {
			const { data, error } = await commsDb(actor.accessToken!).rpc(rpc, args);
			if (error) return fail(502, { message: "We couldn't update your notifications. Try again." });
			return ok({ updated: Number(data ?? 0) });
		} catch {
			return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
		}
	}
	// #endregion
}
