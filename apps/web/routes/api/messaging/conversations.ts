import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type {
	ConversationListParams,
	ConversationRelation,
	ConversationView,
	MessagingRole,
} from "@projective/types/messaging";

/**
 * `GET /api/messaging/conversations?q=…&view=…&unread=1&role=…&rel=…&svc=…&prod=…&entity=…&member=…&cursor=…`
 * — thin route: parse the sidebar's search + partition + advanced-filter facets (each facet a repeated
 * param → an OR-set), then delegate to the fat {@link MessagingBackendService} for a filtered, paged,
 * most-recently-active page (the inbox list, with the `messageCount > 0` visibility rule applied).
 *
 * `POST /api/messaging/conversations` — start a conversation from the picked contacts (a stub that
 * returns the deterministic conversation id; persistence lands with the backend behind
 * `MESSAGING_BACKEND_LIVE`).
 */
function parseParams(url: URL): ConversationListParams {
	const p = url.searchParams;
	const relations = p.getAll("rel") as ConversationRelation[];
	const serviceIds = p.getAll("svc");
	const productIds = p.getAll("prod");
	const entityIds = p.getAll("entity");
	const memberIds = p.getAll("member");
	const hasFilter = relations.length + serviceIds.length + productIds.length + entityIds.length +
			memberIds.length > 0;
	const limitRaw = p.get("limit");
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
	const view = p.get("view");
	const role = p.get("role");
	return {
		q: p.get("q") ?? undefined,
		view: view ? (view as ConversationView) : undefined,
		unread: p.get("unread") === "1" ? true : undefined,
		role: role ? (role as MessagingRole) : undefined,
		cursor: p.get("cursor"),
		limit: Number.isFinite(limit) ? limit : undefined,
		filter: hasFilter ? { relations, serviceIds, productIds, entityIds, memberIds } : undefined,
	};
}

export const handler = define.handlers({
	GET(ctx) {
		return toMessagingResponse(MessagingBackendService.conversations(parseParams(ctx.url)));
	},
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		const contactIds: string[] = Array.isArray(body?.contactIds)
			? body.contactIds.filter((v: unknown): v is string => typeof v === "string")
			: [];
		if (contactIds.length === 0) {
			return Response.json({ ok: false, message: "Pick at least one contact." }, { status: 400 });
		}
		// Single contact → a unified DM id (`dm-{handle}`, shared with the project DM); several → a group.
		const id = contactIds.length === 1
			? `dm-${contactIds[0]}`
			: `grp-new-${[...contactIds].sort().join("-")}`;
		/*
		 * The optional opening message (a listing inquiry, where the buyer typed their question before
		 * any thread existed). Bounded here rather than trusted: free text arrives from a public,
		 * guest-reachable surface, and the eventual `messages.body` column will have a limit the route
		 * has to honour or the insert 500s. Persistence lands with `MESSAGING_BACKEND_LIVE`; accepting
		 * and echoing it now is what makes the client's send a real send rather than a discard.
		 */
		const message = typeof body?.message === "string" ? body.message.trim().slice(0, 4000) : "";
		return Response.json({
			ok: true,
			data: { id, ...(message ? { messageAccepted: true } : {}) },
		}, { status: 200 });
	},
});
