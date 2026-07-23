import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { MessagingRole } from "@projective/types/messaging";

/**
 * `GET /api/messaging/settings?role=…` — thin route: the Message Settings projection (auto-responses +
 * notification preferences, task §2D) for the acting view, delegated to the fat
 * {@link MessagingBackendService}.
 *
 * `POST /api/messaging/settings` — persist the edited settings (a stub that acknowledges; the write path
 * lands with the backend behind `MESSAGING_BACKEND_LIVE`).
 */
export const handler = define.handlers({
	GET(ctx) {
		const role = ctx.url.searchParams.get("role");
		return toMessagingResponse(
			MessagingBackendService.settings(role ? (role as MessagingRole) : "freelancer"),
		);
	},
	async POST(ctx) {
		// Accept + acknowledge; the fat write path is deferred (root CLAUDE.md §1). Body is the settings.
		await ctx.req.json().catch(() => null);
		return Response.json({ ok: true, data: { ok: true } }, { status: 200 });
	},
});
