import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import InboxView from "@web/features/messaging/islands/InboxView.island.tsx";
import { resolveConversationList } from "@web/features/messaging/core/conversations-ssr.ts";

/**
 * `/messages` — the global inbox root. **The conversation list renders here, in the body**, which is
 * where the region contract puts data (the lane owns scope, the header band identity + global
 * controls, the footer band actions + density — see `inbox-slots.tsx`).
 *
 * That placement is also what keeps the route usable below the shell's 767px breakpoint, where
 * `.ui-middle-nav__lane` is removed: with the list in the body, a narrow viewport loses the scope
 * shortcuts, not the inbox.
 *
 * The component is `async` because the inbox read reaches Postgres once `MESSAGING_BACKEND_LIVE` is
 * on. Fresh supports that natively — it detects an async component and renders it through
 * `renderAsyncAnyComponent` — so the list still ships resolved in the first byte rather than arriving
 * after a client round-trip.
 */
export default define.page(async function MessagesIndex(ctx) {
	const { page, role } = await resolveConversationList(
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	return <InboxView initial={page} role={role} path={ctx.url.pathname} />;
});
