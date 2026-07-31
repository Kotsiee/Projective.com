import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/view-control-rig.css";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { filesZoom } from "../core/view-state.ts";
import { GridIcon, ListIcon } from "../components/file-glyphs.tsx";

/**
 * ViewControlRig — the File Explorer's view-control rig, mounted in the middle-nav FOOTER band
 * (left-aligned, `sticky; bottom: 0`) via {@link filesFooterFor}. The control itself is the shared
 * {@link ViewZoomRig}: a non-interactive current-view glyph, then the minus button · a segmented zoom
 * track with a centred transition marker · the plus button. It writes the shared `zoom` signal, so the
 * explorer body (a separate island) reactively swaps its presentation. Dumb island: no data access.
 */
export default function ViewControlRig(): JSX.Element {
	useEffect(() => filesZoom.restoreZoom(), []);

	return (
		<ViewZoomRig
			store={filesZoom}
			label="File view zoom"
			class="fx-rig"
			listIcon={<ListIcon size={16} />}
			gridIcon={<GridIcon size={16} />}
		/>
	);
}
