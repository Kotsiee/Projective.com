import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import InboxHeader from "../islands/InboxHeader.island.tsx";
import InboxFooter from "../islands/InboxFooter.island.tsx";
import InboxScopeLane from "../islands/InboxScopeLane.island.tsx";
import MessagesSidebar from "../islands/MessagesSidebar.island.tsx";
import { resolveConversationList, resolveMessagingSettings } from "./conversations-ssr.ts";
import { DEFAULT_MESSAGING_SETTINGS } from "./messaging-defaults.ts";

/**
 * inbox-slots — the SSR-idiomatic resolvers for the `/messages` ROOT's three shell regions, mirroring
 * `walletHeaderFor` / `walletFooterFor` / `walletLaneFor`.
 *
 * The root previously owned **no** header band and **no** footer band (both resolvers returned `null`
 * off a specific conversation), which is why every global control had collected in the lane. These
 * restore the contract:
 *
 *  - **lane** → {@link InboxScopeLane}: scope and navigation (partitions + relation facets, counted).
 *  - **header band** → {@link InboxHeader}: identity, live count, search, id-based refinements.
 *  - **footer band** → {@link InboxFooter}: New message · Settings · row density.
 *
 * Each returns `null` on a specific conversation, where the conversation's own header/footer/lane
 * resolvers take over — the detail route keeps the conversation list in the lane, which is genuine
 * sibling navigation.
 *
 * Server-only (they reach `@server/services` via `conversations-ssr`); never imported by an island.
 */

/** True only on the bare `/messages` root (a conversation id makes it a detail route). */
function isInboxRoot(url: URL): boolean {
	const segs = url.pathname.split("/").filter(Boolean);
	return segs[0] === "messages" && segs.length === 1;
}

/**
 * The `/messages` root header band — identity + global controls.
 *
 * `initialCount` counts the DEFAULT PARTITION, not the raw page: the body opens on the inbox slice,
 * which excludes archived conversations, so counting the whole page made the header's first paint
 * disagree with the list beneath it by however many were archived.
 */
export function inboxHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!isInboxRoot(url)) return null;
	const { page, role } = resolveConversationList(context);
	const initialCount = page.conversations.filter((c) => !c.archived).length;
	return <InboxHeader role={role} initialCount={initialCount} />;
}

/** The `/messages` root footer band — actions + density. */
export function inboxFooterFor(url: URL, _context: UserContext): ComponentChildren {
	if (!isInboxRoot(url)) return null;
	return <InboxFooter />;
}

/**
 * The `/messages` lane. On the root it is the scope map; beside an open conversation it is the
 * conversation list ({@link MessagesSidebar}) — navigation among siblings.
 */
export function messagesLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/messages")) return null;
	const { page, role } = resolveConversationList(context);
	const settings = resolveMessagingSettings(context) ?? DEFAULT_MESSAGING_SETTINGS;

	if (isInboxRoot(url)) return <InboxScopeLane role={role} settings={settings} />;
	return <MessagesSidebar initial={page} role={role} path={url.pathname} settings={settings} />;
}
