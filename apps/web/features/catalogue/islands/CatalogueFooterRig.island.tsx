import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/console.css";
import { Icon } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { BatchBar } from "../components/BatchBar.tsx";
import { catalogueZoom } from "../core/view-state.ts";
import { selection, startConsoleSync } from "../core/console-store.ts";

/**
 * CatalogueFooterRig — the console's footer band. Ordinarily it owns density: the shared zoom rig
 * (order, search and New listing live in the canvas's sticky toolbar, Decision #221). While listings
 * are selected the {@link BatchBar} takes the band over, because acting on a selection is the one
 * thing the seller is doing then. Dumb: it writes the console store only.
 */
export default function CatalogueFooterRig(): JSX.Element {
	useEffect(() => {
		startConsoleSync();
		catalogueZoom.restoreZoom();
	}, []);

	if (selection.value.size > 0) return <BatchBar />;

	return (
		<div class="cat-rig">
			<ViewZoomRig
				store={catalogueZoom}
				label="Catalogue view zoom"
				class="cat-rig__zoom"
				listIcon={<Icon name="list" />}
				gridIcon={<Icon name="grid" />}
			/>
		</div>
	);
}
