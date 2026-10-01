import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import type { ConversationContext } from "@projective/types/messaging";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/messaging/conversations/[id]/context` — thin route: the conversation
 * context drawer's read (the counterpart, the requests between the two, and the actions the viewer
 * may take), delegated to the fat {@link MessagingBackendService.context}. Private to the reader; the
 * three verbs come from {@link defineReadRoute}.
 */
const read = defineReadRoute<{ context: ConversationContext }>({
	resolve: (ctx) => MessagingBackendService.context(ctx.params.id, readActor(ctx)),
	toBody: toMessagingBody,
});

export const handler = define.handlers({ ...read });
