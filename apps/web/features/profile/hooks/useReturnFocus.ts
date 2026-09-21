import { useEffect, useRef } from "preact/hooks";
import { flowOpener } from "../core/profile-state.ts";

/** How long a closing dialog may keep the background inert before the focus return gives up. */
const RETURN_FOCUS_WAIT_MS = 1500;
const RETURN_FOCUS_POLL_MS = 40;

/**
 * When `open` goes true → false and focus has fallen to `<body>`, focus the control recorded in
 * {@link flowOpener} — whichever rig (the hero's or the sticky band's) opened the popover the flow
 * started from.
 *
 * Not immediately: the closing dialog stays MOUNTED for its exit motion — focus still sits on the
 * control that dismissed it and its trap keeps the background `inert` — and a focus call on an
 * inert element is silently ignored. So this polls until the dialog has let go (focus has fallen
 * to `<body>` and the opener is out from under `[inert]`), because the trap releases from an
 * effect cleanup that fires no event, and gives up after a bounded wait rather than holding a
 * timer for a dialog that never unmounts. Focus that lands anywhere OUTSIDE a dialog meanwhile is
 * somebody else's decision and wins. An opener that is not focusable any more (the band collapsed
 * with `visibility: hidden` while the modal was up) simply fails to take focus, which is the
 * browser's own no-op rather than an error.
 */
export function useReturnFocus(open: boolean): void {
	const wasOpen = useRef(false);
	useEffect(() => {
		const before = wasOpen.current;
		wasOpen.current = open;
		if (open || !before) return;
		const deadline = Date.now() + RETURN_FOCUS_WAIT_MS;
		let id: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			const el = flowOpener.current;
			if (!el || !el.isConnected) return;
			const active = document.activeElement;
			const inDialog = !!active?.closest('[role="dialog"]');
			if (active && active !== document.body && !inDialog) return;
			if (inDialog || el.closest("[inert]")) {
				if (Date.now() < deadline) id = setTimeout(tick, RETURN_FOCUS_POLL_MS);
				return;
			}
			el.focus();
		};
		id = setTimeout(tick, 0);
		return () => clearTimeout(id);
	}, [open]);
}
