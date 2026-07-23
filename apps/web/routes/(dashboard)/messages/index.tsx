import { define } from "@web/utils/state.ts";
import { MessagesEmptyState } from "@web/features/messaging/components/MessagesEmptyState.tsx";

/**
 * `/messages` — the global inbox root. The conversation list + search + advanced filters live in the
 * middle-nav lane (the `MessagesSidebar`, resolved by the dashboard `laneFor`); this canvas is the
 * "pick or start a conversation" prompt shown before one is opened.
 */
export default define.page(function MessagesIndex() {
	return <MessagesEmptyState />;
});
