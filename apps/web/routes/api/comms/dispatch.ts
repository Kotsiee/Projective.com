import { define } from "@web/utils/state.ts";
import { answerDispatch } from "@features/notifications/core/dispatch-ssr.ts";

/**
 * `POST /api/comms/dispatch` — the notification dispatcher's entry point (Decision #344 (a)). The
 * `comms.notifications` trigger posts `{ notification_id }` here through pg_net with
 * `Authorization: Bearer <COMMS_DISPATCH_SECRET>` (Vault), and one pass sends that notification's
 * email, push and SMS deliveries (`NotificationDispatchService.dispatch`). Anything without the bearer
 * is a 404. Exempt from the browser-origin guard as a named server-to-server door (`utils/csrf.ts`).
 */
export const handler = define.handlers({
	POST(ctx) {
		return answerDispatch(ctx.req);
	},
});
