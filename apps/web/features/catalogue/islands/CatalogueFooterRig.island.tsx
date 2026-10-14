import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/console.css";
import { Button, SortControl } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { BatchBar } from "../components/BatchBar.tsx";
import { SORT_OPTIONS } from "../core/catalogue-model.ts";
import { catalogueZoom } from "../core/view-state.ts";
import { consoleView, openCreate, selection, startConsoleSync } from "../core/console-store.ts";
import { useConsoleSort } from "../hooks/useConsoleSort.ts";
import type { ConsoleUrlState } from "../types/catalogue-types.ts";

/**
 * CatalogueFooterRig — the console's footer band. Ordinarily it owns density and order: the shared
 * zoom rig, the sort control, and — below the mobile breakpoint, where the lane is hidden — New
 * listing. While listings are selected the {@link BatchBar} takes the band over, because acting on a
 * selection is the one thing the seller is doing then. Dumb: it writes the console store only.
 */
export interface CatalogueFooterRigProps {
	url: ConsoleUrlState;
}

export default function CatalogueFooterRig(props: CatalogueFooterRigProps): JSX.Element {
	useEffect(() => {
		startConsoleSync();
		catalogueZoom.restoreZoom();
	}, []);

	const state = consoleView(props.url);
	const sort = useConsoleSort(state);

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
			<div class="cat-rig__end">
				<SortControl
					options={[...SORT_OPTIONS]}
					value={sort.sort}
					direction={sort.dir}
					onValueChange={sort.onSort}
					onDirectionChange={sort.onDir}
					size="sm"
					aria-label="Sort listings"
				/>
				<Button
					size="sm"
					rounded
					class="cat-rig__new"
					label="New listing"
					icon={<Icon name="plus" />}
					onClick={() => openCreate()}
				/>
			</div>
		</div>
	);
}
