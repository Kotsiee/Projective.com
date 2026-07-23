import type { JSX } from "preact";
import "../styles/profile-message.css";
import { DraggablePopover } from "@projective/ui/overlay";
import { Avatar } from "@projective/ui/display";
import ChatComposer from "@web/features/projects/islands/ChatComposer.island.tsx";
import { quickMessageOpen } from "../core/profile-state.ts";
import type { ProfileView } from "../types/profile-types.ts";

/**
 * ProfileMessagePopover — the floating draggable quick-message composer opened by a profile's "Message"
 * button (task §3), INSTEAD of navigating to the inbox. Mounted once in the profile action lane; the
 * Message triggers (lane + header `ProfileActions`) flip the shared {@link quickMessageOpen} signal.
 *
 * It reuses the `DraggablePopover` shell + the project {@link ChatComposer} verbatim, pre-addressed to
 * this profile. On the FIRST send it creates the conversation record (a stub — the deterministic unified
 * `dm-{handle}` id) and navigates into `/messages/[conversationId]`, where the conversation seamlessly
 * continues (task §3). A guest is routed through the `(dashboard)` guard (sign-in) exactly like the rest
 * of messaging.
 */
export default function ProfileMessagePopover({ profile }: { profile: ProfileView }): JSX.Element {
	// The canonical unified DM id shares the project DM convention (`dm-{handle}`), sans the leading `@`.
	const handle = profile.handle.replace(/^@/, "");
	const conversationId = `dm-${handle}`;

	function goToConversation(): void {
		try {
			globalThis.location.href = `/messages/${conversationId}`;
		} catch { /* SSR / no window — non-fatal */ }
	}

	return (
		<DraggablePopover
			open={quickMessageOpen}
			title={`Message ${profile.name}`}
			icon={
				<Avatar image={profile.avatar ?? undefined} label={profile.name} size={20} shape="circle" />
			}
			width="22rem"
			class="pf-msgpop"
		>
			<div class="pf-msgpop__body">
				<div class="pf-msgpop__recipient">
					<Avatar
						image={profile.avatar ?? undefined}
						label={profile.name}
						size={40}
						shape="circle"
					/>
					<div class="pf-msgpop__recipient-text">
						<span class="pf-msgpop__recipient-name">{profile.name}</span>
						<span class="pf-msgpop__recipient-handle">@{handle}</span>
					</div>
				</div>
				<p class="pf-msgpop__hint">
					Start the conversation — your first message opens the full thread in your inbox.
				</p>
				<div class="pf-msgpop__composer">
					<ChatComposer
						projectId={conversationId}
						channelId={conversationId}
						onSend={goToConversation}
					/>
				</div>
			</div>
		</DraggablePopover>
	);
}
