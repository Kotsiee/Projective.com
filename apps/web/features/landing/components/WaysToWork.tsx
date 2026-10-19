import type { JSX } from "preact";
import type { Rail } from "@features/landing/core/rails.ts";
import RailScroll from "@features/landing/islands/RailScroll.island.tsx";
import { WaysToWorkView } from "@features/landing/components/WaysToWorkView.tsx";

// #region Component
/** Props for {@link WaysToWork}. */
export interface WaysToWorkProps {
	/**
	 * The live rails: `sliceRails(landing)` (`core/rails.ts`), called on the server with the page's
	 * `LandingPayload | null`. Each is bounded and carries only what its cards print; `[]` hides the
	 * rails block.
	 */
	rails: readonly Rail[];
}

/**
 * WaysToWork — the landing's "Ways to work" section, `#ways-to-work` (`flows/LANDING.md` §4.5;
 * work order L4, layout F): {@link WaysToWorkView} — the three ways and the live rails, all
 * server-rendered — with the {@link RailScroll} island inside it, which wires the rails' scroll
 * buttons and carries the section's stylesheet. The island mounts even when no rail renders, so the
 * three ways are styled on a page whose feed read failed.
 */
export function WaysToWork({ rails }: WaysToWorkProps): JSX.Element {
	return (
		<WaysToWorkView rails={rails}>
			<RailScroll />
		</WaysToWorkView>
	);
}

export default WaysToWork;
// #endregion
