import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import MessagesSidebar from "../islands/MessagesSidebar.island.tsx";
import { resolveConversationList, resolveMessagingSettings } from "./conversations-ssr.ts";
import { DEFAULT_MESSAGING_SETTINGS } from "./messaging-defaults.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * inbox-slots — the SSR-idiomatic lane resolver for every `/messages` route, mirroring
 * `walletLaneFor` / `laneFor`.
 *
 * ONE lane for the whole hierarchy. The `/messages` root and `/messages/[conversationId]` both
 * resolve the same {@link MessagesSidebar} — the conversation list with its search, partitions,
 * filters, per-row actions and the New message / Settings controls — so the lane is one component
 * with one persisted state (`LocalKeys.MESSAGES_FILTERS` · `CONVERSATION_PREFS`) wherever the
 * viewer is in the inbox, and the active-row highlight follows the pathname. The root's body is
 * then an empty state (desktop) or the transferred list (phone) — see `MessagesRoot`.
 *
 * The root carries NO header band and NO footer band: the lane already owns search, filters and
 * the two global actions, and the body's empty state carries the primary CTA; a second search or
 * a second New-message on the same screen is a control that can disagree with its twin. On an
 * open conversation the conversation's own header/footer resolvers take over.
 *
 * Server-only (it reaches `@server/services` via `conversations-ssr`); never imported by an island.
 */

/** The `/messages` lane — the conversation list, on the root and beside an open conversation alike. */
export async function messagesLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!url.pathname.startsWith("/messages")) return null;
	const [{ page, role }, settings] = await Promise.all([
		resolveConversationList(context, actor),
		resolveMessagingSettings(context, actor),
	]);
	return (
		<MessagesSidebar
			initial={page}
			role={role}
			path={url.pathname}
			settings={settings ?? DEFAULT_MESSAGING_SETTINGS}
		/>
	);
}
