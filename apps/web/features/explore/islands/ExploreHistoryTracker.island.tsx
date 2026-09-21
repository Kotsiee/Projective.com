import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { ensureTracked } from "../core/explore-history.ts";

/**
 * ExploreHistoryTracker — a zero-UI island that records the current page in the Explore tree's
 * visit stack (`core/explore-history.ts`). Mounted ONCE, globally, from `_app.tsx`: every page is
 * a candidate — an eligible one pushes its address, any other one marks the chain as broken — so
 * the surfaces that render a Back control (`/[handle]`, `/view/[id]`) are not the only ones that
 * know where the visitor has been. `/explore` itself, which shows no Back control, is the page
 * the stack most needs to remember, filters and all.
 *
 * `ensureTracked` is idempotent, so a Back control mounting first on the same page costs nothing.
 * Renders a `hidden`, `aria-hidden` stub.
 */
export default function ExploreHistoryTracker(): JSX.Element {
	useEffect(() => {
		ensureTracked();
	}, []);
	return <span hidden aria-hidden="true" />;
}
