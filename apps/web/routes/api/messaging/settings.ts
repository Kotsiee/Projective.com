import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { MessagingRole, MessagingSettings } from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/settings?role=…` — thin route: the Message Settings projection
 * (auto-responses + notification preferences, task §2D) for the acting view, delegated to the fat
 * {@link MessagingBackendService}.
 *
 * The three read verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives
 * the responses from it — so `HEAD` cannot drift from `GET`, and the `ETag` / `If-None-Match`
 * revalidation is identical on both. See that module for the caching and CORS decisions.
 *
 * `POST /api/messaging/settings` — persist the edited settings (a stub that acknowledges; the write path
 * lands with the backend behind `MESSAGING_BACKEND_LIVE`). It sits alongside the generated read
 * handlers rather than inside them: a mutation has no validator and no shared resolution to derive.
 */
const read = defineReadRoute<{ settings: MessagingSettings }>({
	resolve: (ctx) => {
		const role = ctx.url.searchParams.get("role");
		return MessagingBackendService.settings(
			role ? (role as MessagingRole) : "freelancer",
			readActor(ctx),
		);
	},
	toBody: toMessagingBody,
	// This route also serves POST (save settings); `Allow` and the preflight must say so.
	alsoAllows: ["POST"],
});

export const handler = define.handlers({
	...read,
	async POST(ctx) {
		// Accept + acknowledge; the fat write path is deferred (root CLAUDE.md §1). Body is the settings.
		await ctx.req.json().catch(() => null);
		return Response.json({ ok: true, data: { ok: true } }, { status: 200 });
	},
});
