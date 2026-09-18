import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { MessagesRoot } from "@web/features/messaging/components/MessagesRoot.tsx";
import { resolveConversationList } from "@web/features/messaging/core/conversations-ssr.ts";

/**
 * `/messages` — the global inbox root, with no conversation open.
 *
 * The conversation list lives in the middle-nav LANE here exactly as it does beside an open
 * conversation (`messagesLaneFor` resolves the same `MessagesSidebar` for both), so the lane is one
 * component with one state on every `/messages` route. The body is therefore an empty state on
 * desktop — pick a thread, or start one — and, below the shell's 767px breakpoint where the lane is
 * removed, the inbox list itself ({@link MessagesRoot}).
 *
 * `async` because the inbox read reaches Postgres once `MESSAGING_BACKEND_LIVE` is on; Fresh renders
 * an async component natively, so the phone's list still ships in the first byte.
 */
export default define.page(async function MessagesIndex(ctx) {
	const { page, role } = await resolveConversationList(
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	return <MessagesRoot page={page} role={role} path={ctx.url.pathname} />;
});
