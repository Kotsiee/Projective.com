import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
import { SortControl } from "@projective/ui/fields";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { catalogueZoom } from "../core/view-state.ts";
import { GridIcon, ListIcon, PlusIcon } from "../components/catalogue-glyphs.tsx";
import { consoleSort, consoleSortDir, openCreate } from "../core/catalogue-state.ts";
import { defaultSortDir, SORT_OPTIONS } from "../core/catalogue-model.ts";
import type { CatalogueSort, CatalogueSortDir } from "../types/catalogue-types.ts";

/**
 * CatalogueViewControlRig — the console's middle-nav FOOTER band. Per the region contract the footer
 * owns **actions and density**, so it carries three things:
 *
 *  - the shared {@link ViewZoomRig} (this rig and the File Explorer's are ONE control, not two that
 *    resemble each other) — the density half;
 *  - the `SortControl`, moved out of the body toolbar to sit beside the density control it has always
 *    belonged next to;
 *  - a create action that appears **only below the mobile breakpoint**, where the lane — the only
 *    other home for `New listing` — is `display: none`. Without it a seller on a phone could browse
 *    their catalogue but not add to it, unless it happened to be empty. (The lane's other orphaned
 *    control, the type switch, went to the header band: three controls do not fit a 390px band, and
 *    hiding the page title there frees exactly the room the segment needs.)
 *
 * Dumb island: no data access. Sort writes the shared signals the body refetches from.
 */
export default function CatalogueViewControlRig(): JSX.Element {
	useEffect(() => catalogueZoom.restoreZoom(), []);

	return (
		<div class="cat-rig">
			<ViewZoomRig
				store={catalogueZoom}
				label="Catalogue view zoom"
				class="cat-rig__zoom"
				listIcon={<ListIcon size={16} />}
				gridIcon={<GridIcon size={16} />}
			/>

			<div class="cat-rig__end">
				<SortControl
					options={[...SORT_OPTIONS]}
					value={consoleSort as Signal<string>}
					direction={consoleSortDir}
					onValueChange={(key) => {
						const k = key as CatalogueSort;
						consoleSort.value = k;
						consoleSortDir.value = defaultSortDir(k);
					}}
					onDirectionChange={(d: CatalogueSortDir) => (consoleSortDir.value = d)}
					size="sm"
					aria-label="Sort listings"
				/>

				{/* Mobile-only — the lane, which owns `New listing` everywhere else, is hidden here. */}
				<button
					type="button"
					class="cat-rig__new"
					onClick={() => openCreate()}
				>
					<PlusIcon size={16} />
					<span>New listing</span>
				</button>
			</div>
		</div>
	);
}
