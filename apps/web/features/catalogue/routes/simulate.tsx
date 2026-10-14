import { define } from "@web/utils/state.ts";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import PreviewFrameBridge from "../islands/PreviewFrameBridge.island.tsx";
import { handler } from "./simulate-handler.ts";

export { handler };

/**
 * `/catalogue/[id]/simulate` — the listing exactly as a buyer meets it on `/view/[id]`, rendered by
 * the SAME `EntityViewPage` in simulation mode (Decision #217 (j)): the conversion lane, the archetype
 * and the resolved CTA are real, every CTA opens its real modal, and every commit resolves locally
 * with the would-be outcome instead of booking or charging anything. It runs in `bare` chrome (no
 * rails, no bands, no top bar), because the item workspace's Preview tab frames it.
 */
export default define.page<typeof handler>(function ListingSimulationPage({ data }) {
	return (
		<>
			<EntityViewPage
				view={data.view ?? undefined}
				unavailable={data.unavailable}
				ctx={{ scope: "explore" }}
				authed
				offer={data.offer}
				schedule={data.schedule}
				simulation
			/>
			<PreviewFrameBridge />
		</>
	);
});
