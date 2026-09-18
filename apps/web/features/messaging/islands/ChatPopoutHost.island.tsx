import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/chat-popout.css";
import { DraggablePopover } from "@projective/ui/overlay";
import { Avatar } from "@projective/ui/display";
import { Toast } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { PopoutChat } from "../components/PopoutChat.tsx";
import {
	closePopout,
	hydratePopout,
	movePopout,
	popout,
	resizePopout,
} from "../core/popout-state.ts";

/**
 * ChatPopoutHost — the GLOBAL host for the floating chat window: the "Pop Out Chat" of a channel or
 * conversation page, and the messenger a profile's "Message" control opens. Mounted once by EVERY
 * authenticated layout (`(dashboard)`, the authed `(public)` branch and the authed `/[handle]`
 * branch), so a window opened on a profile survives a navigation to Explore, the inbox or a
 * project: it re-seeds from `sessionStorage` on every mount ({@link hydratePopout}) and, when an
 * active pop-out state exists, renders a {@link DraggablePopover} carrying the {@link PopoutChat}
 * (feed + composer + whole-panel file drop zone). Fresh navigations are full-page, so "persists
 * across route transitions" here means "persists across documents" — the store is the state, the
 * window is a projection of it, and both are rebuilt identically on the next page.
 *
 * Navigation memory: the host receives the current pathname; when the viewer is not on the popped-out
 * channel/conversation's own page, a header action routes there — "Return" for a chat popped out of
 * its page, "Open in inbox" for a conversation started from a profile, which the viewer was never on.
 *
 * A profile-started window DOCKS into the bottom-end corner the first time it opens (the anchor is
 * only consulted when nothing remembered where the window was); a drag or a resize is persisted, so
 * the window reopens where and at the size it was left.
 *
 * Below 768px the host renders nothing: a 24rem floating window has nowhere to float on a phone, and
 * the profile's Message control opens a bottom sheet there instead (DESIGN_SYSTEM.md Part D.3).
 *
 * The composer inside runs in `toast` notice mode, so this host also mounts the shared toast stack
 * at `bottom-center` — once, and never beside a stack another island already put up.
 */
export default function ChatPopoutHost({ path }: { path: string }): JSX.Element | null {
	const mobile = useIsMobile();
	const toastMounted = useSignal(false);

	// Re-seed the store from sessionStorage on mount (survives full-page navigations).
	useEffect(() => {
		hydratePopout();
	}, []);

	const state = popout.value;

	// A stack already on the page renders from the same module-level signal, so pushing into it is
	// enough; mounting a second one at the same anchor would draw every toast twice.
	useEffect(() => {
		if (!state) return;
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
	}, [state !== null]);

	if (!state || mobile) return null;

	const onPage = path === state.href || path.startsWith(state.href + "/");
	const hasPos = state.x != null && state.y != null;
	const hasSize = state.w != null && state.h != null;
	const fromProfile = state.source === "profile";
	const returnLabel = fromProfile ? "Open in inbox" : "Return";
	const returnName = fromProfile ? "Open this conversation in your inbox" : "Return to channel";

	return (
		<>
			<DraggablePopover
				open
				onOpenChange={(o) => {
					if (!o) closePopout();
				}}
				title={state.title}
				icon={state.avatar
					? <Avatar image={state.avatar} label={state.title} size={20} shape="circle" />
					: <MessagingIcon name="chat" />}
				width="24rem"
				height="min(60vh, 34rem)"
				anchor={fromProfile ? "bottom-end" : undefined}
				defaultPosition={hasPos ? { x: state.x!, y: state.y! } : undefined}
				defaultSize={hasSize ? { w: state.w!, h: state.h! } : undefined}
				onPositionChange={(pos) => movePopout(pos.x, pos.y)}
				onSizeChange={(size) => resizePopout(size.w, size.h)}
				class="chat-popout"
				headerActions={onPage
					? undefined
					: (
						<a class="chat-popout__return" href={state.href} aria-label={returnName}>
							<MessagingIcon name="maximize" />
							<span class="chat-popout__return-label">{returnLabel}</span>
						</a>
					)}
			>
				<PopoutChat state={state} />
			</DraggablePopover>
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}
