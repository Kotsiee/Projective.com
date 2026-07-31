import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { catalogueZoom } from "../core/view-state.ts";
import { GridIcon, ListIcon } from "../components/catalogue-glyphs.tsx";

/**
 * CatalogueViewControlRig — the console's view-control rig, mounted in the middle-nav FOOTER band via
 * {@link catalogueFooterFor}. It is the shared {@link ViewZoomRig}, so this rig and the File
 * Explorer's are ONE control rather than two that resemble each other: a non-interactive current-view
 * glyph, then the minus button · a segmented zoom track with a centred transition marker · the plus
 * button. It writes the shared `zoom` signal, so the console body (a separate island) reactively swaps
 * its presentation. Dumb island: no data access.
 */
export default function CatalogueViewControlRig(): JSX.Element {
	useEffect(() => catalogueZoom.restoreZoom(), []);

	return (
		<ViewZoomRig
			store={catalogueZoom}
			label="Catalogue view zoom"
			class="cat-rig"
			listIcon={<ListIcon size={16} />}
			gridIcon={<GridIcon size={16} />}
		/>
	);
}
