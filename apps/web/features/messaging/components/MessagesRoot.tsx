import type { JSX } from "preact";
import MessagesEmptyState from "../islands/MessagesEmptyState.island.tsx";
import InboxHeader from "../islands/InboxHeader.island.tsx";
import InboxFooter from "../islands/InboxFooter.island.tsx";
import InboxView from "../islands/InboxView.island.tsx";
import type { ConversationListPage, MessagingRole } from "../types/messaging-types.ts";

/**
 * MessagesRoot — the `/messages` root BODY, rendered server-side with both of its presentations in
 * the DOM and exactly one visible at any width (`messages-root.css`):
 *
 *  - **Desktop (≥ 768px)** — the conversation list is in the lane (the same `MessagesSidebar` an
 *    open conversation renders beside itself), so the body is the {@link MessagesEmptyState}: an
 *    instruction to pick a thread, and the New message / New group actions.
 *  - **Phone (≤ 767px)** — the shell removes the lane, so the list would vanish with it. The inbox
 *    TRANSFERS here: the header band's search + refinements, the actions row, and the list itself
 *    (the `InboxView` island, the single fetch owner of `inbox-state`). Server-painted, so a phone
 *    with JavaScript off still gets its inbox.
 *
 * `initialCount` counts the DEFAULT PARTITION (archived excluded), which is what the body opens on,
 * so the header's first paint agrees with the list beneath it.
 */
export interface MessagesRootProps {
	page: ConversationListPage;
	role: MessagingRole;
	path: string;
}

export function MessagesRoot({ page, role, path }: MessagesRootProps): JSX.Element {
	const initialCount = page.conversations.filter((c) => !c.archived).length;
	return (
		<div class="msg-root">
			<div class="msg-root__desktop">
				<MessagesEmptyState />
			</div>
			<div class="msg-root__mobile">
				<InboxHeader role={role} initialCount={initialCount} />
				<InboxFooter />
				<InboxView initial={page} role={role} path={path} />
			</div>
		</div>
	);
}
