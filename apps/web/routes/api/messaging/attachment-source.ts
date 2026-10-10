import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { AttachmentSource } from "@projective/types/projects";

/**
 * `GET /api/messaging/attachment-source?assetId=&conversationId=` — the thin route for the reverse
 * lookup behind the preview modal's "Go to message": which messages a `files.items` asset was posted
 * in, newest first. HTTP parse + the one required param, then {@link MessagingBackendService.attachmentSource},
 * which runs under the caller's session so RLS decides what comes back.
 *
 * `GET`, `HEAD` and `OPTIONS` come from {@link defineReadRoute}, so the validator and the missing-param
 * `400` are identical on every verb.
 */
export const handler = define.handlers(
	defineReadRoute<{ sources: AttachmentSource[] }>({
		resolve: (ctx) => {
			const sp = ctx.url.searchParams;
			const assetId = sp.get("assetId")?.trim() ?? "";
			if (!assetId) {
				return Response.json({ ok: false, message: "Missing assetId." }, { status: 400 });
			}
			return MessagingBackendService.attachmentSource(assetId, readActor(ctx), {
				conversationId: sp.get("conversationId") || null,
			});
		},
		toBody: toMessagingBody,
	}),
);
