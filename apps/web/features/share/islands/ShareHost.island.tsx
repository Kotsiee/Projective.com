import type { ComponentType, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useMemo } from "preact/hooks";
import { Dialog, Popover, Toast, useToast } from "@projective/ui/feedback";
import { useIsMobile } from "@projective/ui/hooks";
import "../styles/share.css";
import "../styles/share-people.css";
import { dismissShare, shareOpen, shareRequest } from "../core/share-request.ts";
import type { ShareModalBodyProps } from "../components/ShareModalBody.tsx";

/**
 * ShareHost — the ONE mounted owner of the share surface, rendered once per shell (`UserShell` and
 * `GuestShell`, so it is on every page a Share control can appear on) and driven by the shared
 * `share-request` bridge: every trigger calls `requestShare(…)`, and this island opens.
 *
 * **Anchored where it can be** (Decision #405): a request from a standing button (`anchor`) opens as a
 * `Popover` on that button from `--bp-md` up, with no scrim, so the page stays in view; a request from
 * a menu row, or any request on a phone, opens the `Dialog` (a bottom sheet below `--bp-md`). The
 * body is the same either way. The popover is anchored through its trigger ref rather than
 * `targetRef`, whose own click toggle would undo the button's `requestShare` on every re-open; a
 * second press on the same button closes it in `requestShare` instead.
 *
 * The body is loaded LAZILY on first open. The host itself ships to every page, so it is kept to a
 * signal subscription and its two shells; the people search, its transport and the external targets
 * arrive in their own chunk the first time somebody presses Share. Both stylesheets are imported HERE,
 * statically, because a sheet only reaches the browser through an island's module graph (Decision
 * #39).
 *
 * Signed in, the surface is headed **Send to…** (Decision #406); a guest's is "Share this {noun}"
 * and holds the link alone. A send that reached everyone closes the surface and is confirmed by a
 * toast mounted here, since the surface it came from is gone. `authed` comes from the shell, not
 * from a client guess: the shell knows which branch it is rendering.
 */

// #region Props
export interface ShareHostProps {
	/** Whether the viewer is signed in — only a signed-in viewer gets "Send to…"; a guest the link. */
	authed: boolean;
}
// #endregion

type Body = ComponentType<ShareModalBodyProps>;

/** The side an anchored share opens on, and the room it has there. */
interface ShareSide {
	placement: "bottom-end" | "top-end";
	room: number;
}

/**
 * The side with more room, read once per request. The surface's height follows its people, and the
 * positioner re-picks a side whenever a panel outgrows its room — so a panel left to it would hop
 * across its button as a search fills or empties the grid. Opened on the roomier side it never flips
 * (the positioner only flips toward MORE room), and `room` caps it there.
 */
function sideOf(anchor: HTMLElement | null): ShareSide | null {
	if (!anchor) return null;
	const rect = anchor.getBoundingClientRect();
	const below = globalThis.innerHeight - rect.bottom;
	return below >= rect.top
		? { placement: "bottom-end", room: Math.round(below) }
		: { placement: "top-end", room: Math.round(rect.top) };
}

export default function ShareHost(props: ShareHostProps): JSX.Element {
	const body = useSignal<Body | null>(null);
	const loadFailed = useSignal(false);
	const loading = useSignal(false);
	const mobile = useIsMobile();
	const toast = useToast();
	const toastMounted = useSignal(false);

	/** Everyone was reached: close the surface, and say so where it was. */
	function sent(summary: string): void {
		dismissShare();
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity: "success", summary, life: 4000 });
	}

	// Fetch the body chunk the first time the share opens; keep it for every open after.
	useSignalEffect(() => {
		if (!shareOpen.value || body.peek() || loading.peek()) return;
		loading.value = true;
		import("../components/ShareModalBody.tsx")
			.then((mod) => {
				body.value = mod.ShareModalBody;
			})
			.catch(() => {
				loadFailed.value = true;
			})
			.finally(() => {
				loading.value = false;
			});
	});

	const request = shareRequest.value;
	const noun = request?.noun ?? "link";
	const title = props.authed ? "Send to…" : `Share this ${noun}`;
	const Loaded = body.value;
	const asked = request?.anchor;
	const anchor = typeof HTMLElement !== "undefined" && asked instanceof HTMLElement &&
			asked.isConnected
		? asked
		: null;
	const side = useMemo(() => sideOf(anchor), [request]);

	const content = (
		<>
			{request && Loaded && (
				<Loaded
					key={request.url}
					request={request}
					authed={props.authed}
					onSent={sent}
					room={anchor && !mobile ? side?.room ?? null : null}
				/>
			)}
			{request && !Loaded && !loadFailed.value && (
				<p class="share__loading" role="status">Preparing share options…</p>
			)}
			{request && loadFailed.value && (
				<p class="share__loading" role="alert">
					Couldn't load the share options. You can still copy the link:{" "}
					<code class="share__fallback-url">{request.url}</code>
				</p>
			)}
		</>
	);

	const toastHost = toastMounted.value ? <Toast position="bottom-center" /> : null;

	if (anchor && !mobile) {
		return (
			<>
				<Popover
					open={shareOpen}
					trigger={(api) => {
						api.ref.current = anchor;
						return <span hidden />;
					}}
					label={title}
					placement={side?.placement ?? "bottom-end"}
					class="share-pop"
					avoid={[".ui-app-shell__sidebar"]}
					onOpenChange={(open) => {
						if (!open) dismissShare();
					}}
				>
					<p class="share-pop__title" aria-hidden="true">{title}</p>
					{content}
				</Popover>
				{toastHost}
			</>
		);
	}

	return (
		<>
			<Dialog
				visible={shareOpen}
				header={title}
				width="var(--overlay-w-md)"
				class="share-dialog"
				onVisibleChange={(open) => {
					if (!open) dismissShare();
				}}
			>
				{content}
			</Dialog>
			{toastHost}
		</>
	);
}
