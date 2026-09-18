import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody, toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import {
	type ConversationListPage,
	type ConversationListParams,
	type ConversationRelation,
	type ConversationView,
	CreateConversationSchema,
	type MessagingRole,
} from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/conversations?q=…&view=…&unread=1&role=…&rel=…&svc=…&prod=…&entity=…&member=…&cursor=…`
 * — thin route: parse the sidebar's search + partition + advanced-filter facets (each facet a repeated
 * param → an OR-set), then delegate to the fat {@link MessagingBackendService} for a filtered, paged,
 * most-recently-active page (the inbox list, with the `messageCount > 0` visibility rule applied).
 *
 * The three read verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives
 * the responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match`
 * revalidation is identical on both. See that module for the caching and CORS decisions.
 *
 * `POST /api/messaging/conversations` — START a conversation from the picked contacts: one contact
 * (or reopens) a DM, several — or a named group — a group. An optional opening `message` is posted
 * in the same act. Zod-validated against {@link CreateConversationSchema} and delegated to the fat
 * {@link MessagingBackendService.createConversation}, which mints the thread (a definer RPC on the
 * live path, the per-process store on the stub path) and answers with the id every `/messages`
 * route addresses it by. It is a mutation and so is hand-written alongside the generated read
 * handlers rather than produced by the factory.
 *
 * **No capability guard.** Who may open a thread with whom is decided inside the RPCs, which run as
 * definer and check the caller themselves. The 401 is an identity check: a conversation with no
 * first party is not a conversation.
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

const read = defineReadRoute<{ page: ConversationListPage }>({
	resolve: (ctx) => MessagingBackendService.conversations(parseParams(ctx.url), readActor(ctx)),
	toBody: toMessagingBody,
	// This route also serves POST (start a conversation), so `Allow` and the preflight must say so.
	// Advertising only the read verbs tells a browser the write is not permitted, which it honours.
	alsoAllows: ["POST"],
});

export const handler = define.handlers({
	...read,
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to start a conversation." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateConversationSchema.safeParse(raw);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Pick at least one contact.", errors },
				{ status: 422 },
			);
		}

		return toMessagingResponse(
			await MessagingBackendService.createConversation(parsed.data, actor),
		);
	},
});
