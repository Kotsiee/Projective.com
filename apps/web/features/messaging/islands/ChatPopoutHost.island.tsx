import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/chat-popout.css";
import { DraggablePopover } from "@projective/ui/overlay";
import { Toast } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { PopoutChat } from "../components/PopoutChat.tsx";
import {
	closePopout,
	movePopout,
	popout,
	resizePopout,
	syncPopoutRoute,
} from "../core/popout-state.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ChatPopoutHost — the GLOBAL host for the floating chat window: the "Pop Out Chat" of a channel or
 * conversation page, and the messenger a profile's "Message" control opens. Mounted once by EVERY
 * authenticated layout (`(dashboard)`, the authed `(public)` branch and the authed `/[handle]`
 * branch), so a window opened on a profile survives a navigation to Explore, the inbox or a
 * project: it reconciles with `sessionStorage` on every mount ({@link syncPopoutRoute}) and, when an
 * active pop-out state exists, renders a {@link DraggablePopover} carrying the {@link PopoutChat}
 * (feed + composer + whole-panel file drop zone). Fresh navigations are full-page, so "persists
 * across route transitions" here means "persists across documents" — the store is the state, the
 * window is a projection of it, and both are rebuilt identically on the next page.
 *
 * Route lifecycle: arriving at a full chat view (`/messages/[conversationId]`, a channel's Chat tab)
 * from another page closes the window, since that page now shows the chat it duplicated; the page it
 * was spawned on keeps it. A back/forward-cache restore skips the mount, so `pageshow` and
 * `popstate` re-run the same reconciliation.
 *
 * Navigation memory: when the viewer is not on the popped-out channel/conversation's own page, a
 * ghost "Open in input" header action routes there and closes the window.
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

	useEffect(() => {
		syncPopoutRoute(path);
	}, [path]);

	useEffect(() => {
		function onPageShow(event: PageTransitionEvent): void {
			if (event.persisted) syncPopoutRoute(globalThis.location.pathname);
		}
		function onPopState(): void {
			syncPopoutRoute(globalThis.location.pathname);
		}
		globalThis.addEventListener("pageshow", onPageShow);
		globalThis.addEventListener("popstate", onPopState);
		return () => {
			globalThis.removeEventListener("pageshow", onPageShow);
			globalThis.removeEventListener("popstate", onPopState);
		};
	}, []);

	function openInInput(event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		closePopout();
	}

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

	return (
		<>
			<DraggablePopover
				open
				onOpenChange={(o) => {
					if (!o) closePopout();
				}}
				title={state.title}
				icon={state.avatar
					? <UserAvatar image={state.avatar} label={state.title} size={20} shape="circle" />
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
						<a
							class="chat-popout__open"
							href={state.href}
							aria-label="Open in input"
							title="Open in input"
							onClick={openInInput}
						>
							<MessagingIcon name="maximize" />
						</a>
					)}
			>
				<PopoutChat state={state} />
			</DraggablePopover>
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}
