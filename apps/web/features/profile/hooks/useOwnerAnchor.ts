import { useEffect } from "preact/hooks";
import { motionReduced } from "@projective/ui/display";
import { anchorOfHash, type EditAnchor } from "../core/owner-edit.ts";

/**
 * Open a block's editor when the address names it (`/[handle]#skills`) — on arrival and on a later
 * hash change. The hash is an instruction, not page state (the `?add=1` precedent), so it is
 * stripped once taken: a reload or Back does not reopen the editor. The scroll waits for the load
 * event, after which the page's late-arriving sheets can no longer move the block.
 */
export function useOwnerAnchor(anchor: EditAnchor, open: () => void, enabled = true): void {
	useEffect(() => {
		if (!enabled) return;
		const take = (behavior: ScrollBehavior) => {
			if (anchorOfHash(globalThis.location.hash) !== anchor) return;
			open();
			globalThis.history?.replaceState(
				globalThis.history.state,
				"",
				`${globalThis.location.pathname}${globalThis.location.search}`,
			);
			requestAnimationFrame(() => {
				document.getElementById(anchor)?.scrollIntoView({
					block: "center",
					behavior: motionReduced() ? "auto" : behavior,
				});
			});
		};
		const arrive = () => take("auto");
		const onHash = () => take("smooth");
		if (document.readyState === "complete") arrive();
		else globalThis.addEventListener("load", arrive, { once: true });
		globalThis.addEventListener("hashchange", onHash);
		return () => {
			globalThis.removeEventListener("load", arrive);
			globalThis.removeEventListener("hashchange", onHash);
		};
	}, [anchor, enabled]);
}
