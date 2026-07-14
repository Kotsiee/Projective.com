import type { JSX } from "preact";
import "../styles/explore.css";
import "../styles/explore-results.css";
import { EmptyState } from "@projective/ui/utils";
import { DetailPanel } from "./DetailPanel.tsx";
import type { HrefContext } from "../core/routing.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/**
 * EntityView — the standalone item page rendered at `/view/[id]` (and the `[handle]` profile-scoped
 * variant). It reuses {@link DetailPanel} (without the "open full page" action, since this IS the full
 * page) inside a centred reading frame, with a back link honouring the render context. Shown as the
 * target of the Search Results drawer's "Open full page →" button.
 */
export function EntityView(
	{ item, ctx = { scope: "explore" }, backHref = "/explore" }: {
		item: ExploreItem | undefined;
		ctx?: HrefContext;
		backHref?: string;
	},
): JSX.Element {
	return (
		<div class="ex">
			<div class="ex-view">
				<a class="ex-view__back" href={backHref}>← Back to Explore</a>
				{item ? <DetailPanel item={item} ctx={ctx} showOpenFull={false} /> : (
					<EmptyState
						title="Item not found"
						description="This item may have been removed or the link is out of date."
						actions={<a class="ex-btn ex-btn--solid" href="/explore">Explore Projective</a>}
					/>
				)}
			</div>
		</div>
	);
}
