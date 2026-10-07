import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody, toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import {
	type MessagingRole,
	type MessagingSettings,
	MessagingSettingsSchema,
} from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/settings?role=…` — thin route: the Message Settings projection
 * (auto-responses + notification preferences, task §2D) for the acting view, delegated to the fat
 * {@link MessagingBackendService}.
 *
 * The three read verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives
 * the responses from it — so `HEAD` cannot drift from `GET`, and the `ETag` / `If-None-Match`
 * revalidation is identical on both. See that module for the caching and CORS decisions.
 *
 * `POST /api/messaging/settings` — persist the edited settings: Zod-validate the full
 * {@link MessagingSettingsSchema} body (422 with field errors), refuse a guest (401), and delegate to
 * {@link MessagingBackendService.saveSettings}, which writes under the caller's JWT and answers with
 * the settings as now stored. It sits alongside the generated read handlers rather than inside them:
 * a mutation has no validator and no shared resolution to derive.
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
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to save your message settings." },
				{ status: 401 },
			);
		}

		const parsed = MessagingSettingsSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".") || "form";
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted settings.", errors },
				{ status: 422 },
			);
		}

		return toMessagingResponse(await MessagingBackendService.saveSettings(parsed.data, actor));
	},
});
