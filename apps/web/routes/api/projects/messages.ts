import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { MessagePage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/messages?projectId=…&channelId=…&before=…&limit=…` — thin
 * route: guard the required channel identifiers + parse the optional scroll-up cursor, then delegate
 * to the fat {@link ProjectBackendService} for a bottom-anchored page of the channel's conversation
 * (the feed the chat view virtualizes). `before` is the load-older cursor; omit it for the latest
 * page.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-identifier guard returns its `Response` from inside `resolve`
 * for the same reason: the factory strips the body for `HEAD`, so a guard cannot answer one verb and
 * not the other, and cannot leak a body through `HEAD`.
 */
export const handler = define.handlers(
	defineReadRoute<{ page: MessagePage }>({
		resolve: (ctx) => {
			const projectId = ctx.url.searchParams.get("projectId");
			const channelId = ctx.url.searchParams.get("channelId");
			if (!projectId || !channelId) {
				return Response.json(
					{ ok: false, message: "Missing projectId or channelId." },
					{ status: 400 },
				);
			}
			const before = ctx.url.searchParams.get("before");
			const limitRaw = ctx.url.searchParams.get("limit");
			const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

			return ProjectBackendService.messages(
				{
					projectId,
					channelId,
					before: before || null,
					limit: Number.isFinite(limit) ? limit : undefined,
				},
				readActor(ctx),
			);
		},
		toBody: toProjectsBody,
	}),
);
