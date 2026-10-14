import { useEffect } from "preact/hooks";
import { leavesFrame, readScrollMessage, scrollMessage } from "../core/preview-model.ts";

/** How often, at most, the frame reports its scroll position while the reader scrolls. */
const REPORT_EVERY_MS = 200;

/**
 * PreviewFrameBridge — the framed half of the item workspace's Preview tab (Decision #217 (j)).
 * Mounted on `/catalogue/[id]/simulate`; it renders nothing, and does nothing unless the page is
 * framed by its own origin (the workspace). Opened in a tab of its own, the page behaves normally.
 *
 * - **Scroll hand-off.** It reports where the reader has scrolled to and, once loaded, asks for that
 *   position back, so the reload after a save lands where the reader was rather than at the top.
 * - **Links that leave the page open in a new tab.** Every page but the simulation refuses to be
 *   framed, so a link to the seller's profile or the full schedule would otherwise replace the
 *   preview with the browser's refusal. An in-page jump stays in the frame.
 */
export default function PreviewFrameBridge(): null {
	useEffect(() => {
		const parent = globalThis.parent;
		if (!parent || parent === globalThis.window) return;
		const origin = globalThis.location.origin;
		try {
			// A cross-origin parent throws here; this page is never framed by one (`frame-ancestors 'self'`).
			if (parent.location.origin !== origin) return;
		} catch {
			return;
		}

		let last = 0;
		let pending: ReturnType<typeof setTimeout> | undefined;
		const report = () => {
			pending = undefined;
			last = Date.now();
			parent.postMessage(scrollMessage("report", globalThis.scrollY), origin);
		};
		const onScroll = () => {
			if (pending !== undefined) return;
			pending = setTimeout(report, Math.max(0, REPORT_EVERY_MS - (Date.now() - last)));
		};
		const onMessage = (event: MessageEvent) => {
			if (event.source !== parent || event.origin !== origin) return;
			const message = readScrollMessage(event.data);
			if (message?.phase === "restore") {
				globalThis.scrollTo({ top: message.y, behavior: "instant" });
			}
		};
		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			const anchor = (event.target as Element | null)?.closest?.("a[href]");
			if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
			if (!leavesFrame(anchor.href, new URL(globalThis.location.href))) return;
			event.preventDefault();
			globalThis.open(anchor.href, "_blank", "noopener");
		};

		globalThis.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("message", onMessage);
		document.addEventListener("click", onClick);
		parent.postMessage(scrollMessage("ready"), origin);
		return () => {
			clearTimeout(pending);
			globalThis.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("message", onMessage);
			document.removeEventListener("click", onClick);
		};
	}, []);
	return null;
}
