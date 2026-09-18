import type { ComponentType, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import "../styles/share.css";
import "@features/messaging/styles/contact-picker.css";
import { dismissShare, shareOpen, shareRequest } from "../core/share-request.ts";
import type { ShareModalBodyProps } from "../components/ShareModalBody.tsx";

/**
 * ShareHost — the ONE mounted owner of the share modal, rendered once per shell (`UserShell` and
 * `GuestShell`, so it is on every page a Share control can appear on) and driven by the shared
 * `share-request` bridge: every trigger calls `requestShare(…)`, and this island opens.
 *
 * The body is loaded LAZILY on first open. The host itself ships to every page, so it is kept to a
 * signal subscription and a `Dialog`; the ranked people list, its transport and the external
 * targets arrive in their own chunk the first time somebody presses Share, and never for a page
 * where nobody does. Both stylesheets are imported HERE, statically, because a sheet only reaches
 * the browser through an island's module graph (Decision #39) and the lazy chunk's CSS emission on
 * a production build is not something this host may rely on.
 *
 * `authed` and `returnTo` come from the shell, not from a client guess: the shell knows which
 * branch it is rendering.
 */

// #region Props
export interface ShareHostProps {
	/** Whether the viewer is signed in — the internal tier is a picker or a sign-in accordingly. */
	authed: boolean;
	/** The current path, for a guest's return after signing in. */
	returnTo: string;
}
// #endregion

type Body = ComponentType<ShareModalBodyProps>;

export default function ShareHost(props: ShareHostProps): JSX.Element {
	const body = useSignal<Body | null>(null);
	const loadFailed = useSignal(false);
	const loading = useSignal(false);

	// Fetch the body chunk the first time the modal opens; keep it for every open after.
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
	const Loaded = body.value;

	return (
		<Dialog
			visible={shareOpen}
			header={`Share this ${noun}`}
			width="34rem"
			class="share-dialog"
			onVisibleChange={(open) => {
				if (!open) dismissShare();
			}}
		>
			{request && Loaded && (
				<Loaded
					key={request.url}
					request={request}
					authed={props.authed}
					returnTo={props.returnTo}
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
		</Dialog>
	);
}
