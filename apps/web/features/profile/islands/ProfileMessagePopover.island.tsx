import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/profile.css";
import "../styles/profile-message.css";
import { Drawer } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import { dmConversationId } from "@projective/types/messaging";
import { PopoutChat } from "@web/features/messaging/components/PopoutChat.tsx";
import { openPopout, type PopoutState } from "@web/features/messaging/core/popout-state.ts";
import { conversationHref } from "@web/features/messaging/core/conversation-model.ts";
import { quickMessageOpen } from "../core/profile-state.ts";
import { messageReachable } from "../core/profile-model.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMessagePopover — what a profile's "Message" control opens, INSTEAD of navigating to the
 * inbox. Mounted once beside the hero; every Message trigger flips the shared {@link quickMessageOpen}
 * signal, and this island decides which of two surfaces answers it:
 *
 *  - **Desktop** hands the conversation to the GLOBAL floating messenger (`ChatPopoutHost`, mounted by
 *    every authenticated layout) through {@link openPopout}: a draggable, resizable window docked in
 *    the bottom-end corner that persists across page navigations, because its state lives in
 *    `sessionStorage` and the host on the next page rebuilds it. This island renders nothing itself
 *    on desktop — a second window here would be a second place the same conversation could be typed
 *    into.
 *  - **Below 768px** a 24rem window has nowhere to float, so the same conversation body
 *    ({@link PopoutChat}: the message list, the composer with its attachment menu and drop zone)
 *    opens in a bottom-sheet `Drawer` — the sanctioned floating mobile surface (DESIGN_SYSTEM.md
 *    Part D.3).
 *
 * Either way the conversation is the unified `dm-{handle}` thread (PRODUCT_SPEC §Unified Messaging),
 * so what is typed here IS the thread the inbox opens at `/messages/dm-{handle}` — sending posts in
 * place through the inbox's own send door and never navigates. A direct message is person-to-person,
 * so a TEAM's or a BUSINESS's Message reaches its owner (`profile.messageTo`, Decision #244; Teams
 * P1): the thread is the owner's, titled "{Team} · {Owner}" so the window says which page it was
 * opened from — and an entity whose read names no owner opens nothing, because `dm-{slug}` reaches
 * nobody (the rig withholds its Message too). A guest never reaches this surface: the hero routes
 * them to the sign-in prompt instead.
 */
export default function ProfileMessagePopover(
	{ profile }: { profile: ProfileView },
): JSX.Element | null {
	const recipient = profile.messageTo;
	const reachable = messageReachable(profile);
	const handle = (recipient?.handle ?? profile.handle).replace(/^@/, "");
	const conversationId = dmConversationId(handle);
	const mobile = useIsMobile();

	const state: PopoutState = {
		scope: "conversation",
		projectId: conversationId,
		channelId: conversationId,
		conversationId,
		title: recipient ? `${profile.name} · ${recipient.name}` : profile.name,
		href: conversationHref(conversationId),
		source: "profile",
		avatar: profile.avatar || null,
	};

	// Desktop: the request is forwarded to the global host and consumed, so the next press opens (or
	// re-affirms) the window rather than finding a flag that is already true.
	useEffect(() => {
		if (mobile || !quickMessageOpen.value) return;
		if (reachable) openPopout(state);
		quickMessageOpen.value = false;
	}, [quickMessageOpen.value, mobile]);

	if (!mobile || !reachable) return null;

	return (
		<Drawer
			visible={quickMessageOpen}
			position="bottom"
			header={recipient
				? `Message ${recipient.name} at ${profile.name}`
				: `Message ${profile.name}`}
			size="auto"
			class="pf-msgsheet"
		>
			<div class="pf-msgpop__body pf-msgpop__composer">
				<PopoutChat state={state} />
			</div>
		</Drawer>
	);
}
