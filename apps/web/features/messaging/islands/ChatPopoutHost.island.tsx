import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/chat-popout.css";
import { DraggablePopover } from "@projective/ui/overlay";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { PopoutChat } from "../components/PopoutChat.tsx";
import { closePopout, hydratePopout, movePopout, popout } from "../core/popout-state.ts";

/**
 * ChatPopoutHost — the GLOBAL host for the floating "Pop Out Chat" popover (task §1), mounted once by the
 * dashboard layout so a popped-out chat SURVIVES full-page navigations. It re-seeds from `sessionStorage`
 * on every mount ({@link hydratePopout}); when the active pop-out state exists it renders a
 * {@link DraggablePopover} carrying the {@link PopoutChat} (feed + composer + whole-panel file drop zone).
 *
 * Navigation memory (task §1): the host receives the current pathname; when the viewer has navigated
 * AWAY from the popped-out channel/conversation, a **"Return to Channel" / Maximize** button appears in
 * the popover header, routing straight back to the channel page.
 */
export default function ChatPopoutHost({ path }: { path: string }): JSX.Element | null {
	// Re-seed the store from sessionStorage on mount (survives full-page navigations).
	useEffect(() => {
		hydratePopout();
	}, []);

	const state = popout.value;
	if (!state) return null;

	const onPage = path === state.href || path.startsWith(state.href + "/");
	const hasPos = state.x != null && state.y != null;

	return (
		<DraggablePopover
			open
			onOpenChange={(o) => {
				if (!o) closePopout();
			}}
			title={state.title}
			icon={<MessagingIcon name="chat" />}
			width="24rem"
			height="min(60vh, 34rem)"
			defaultPosition={hasPos ? { x: state.x!, y: state.y! } : undefined}
			onPositionChange={(pos) => movePopout(pos.x, pos.y)}
			class="chat-popout"
			headerActions={onPage
				? undefined
				: (
					<a class="chat-popout__return" href={state.href} aria-label="Return to channel">
						<MessagingIcon name="maximize" />
						<span class="chat-popout__return-label">Return</span>
					</a>
				)}
		>
			<PopoutChat state={state} />
		</DraggablePopover>
	);
}
