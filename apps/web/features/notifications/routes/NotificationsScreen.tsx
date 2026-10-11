import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { parseTab, parseView } from "../core/notification-model.ts";
import NotificationsPage from "../islands/NotificationsPage.island.tsx";

/**
 * `/notifications` — the inbox page (DESIGN_SYSTEM §D.9), re-exported by
 * `routes/(dashboard)/notifications/index.tsx`. Thin controller: decode the deep link
 * (`?category=&view=`; anything unknown falls back to All) and hand it to the island, which reads the
 * inbox through `/api/notifications`. The `(dashboard)` guard has already required a session.
 */
export const handler = define.handlers({
	GET(ctx) {
		const q = ctx.url.searchParams;
		ctx.state.title = "Notifications · Projective";
		return page({ tab: parseTab(q.get("category")), view: parseView(q.get("view")) });
	},
});

export default define.page<typeof handler>(function NotificationsScreen({ data }) {
	return <NotificationsPage initialTab={data.tab} initialView={data.view} />;
});
