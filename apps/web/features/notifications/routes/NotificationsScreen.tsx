import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { parseFilter } from "../core/notification-model.ts";
import NotificationsPage from "../islands/NotificationsPage.island.tsx";

/**
 * `/notifications` — the inbox page (DESIGN_SYSTEM §D.9), re-exported by
 * `routes/(dashboard)/notifications/index.tsx`. Thin controller: decode the deep link
 * (`?category=&view=&q=`; anything unknown falls back to All) and hand it to the island, which reads
 * the inbox through `/api/notifications`. The lane beside it is `notificationsLaneFor`'s. The
 * `(dashboard)` guard has already required a session.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Notifications · Projective";
		return page({ filter: parseFilter(ctx.url.searchParams) });
	},
});

export default define.page<typeof handler>(function NotificationsScreen({ data }) {
	return <NotificationsPage initial={data.filter} />;
});
