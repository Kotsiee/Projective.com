import type { JSX } from "preact";
import { SlidersIcon } from "./catalogue-glyphs.tsx";
import { MODEL_OPTIONS } from "../core/catalogue-model.ts";
import type { CatalogueTypeFilter, ServiceType } from "../types/catalogue-types.ts";

/**
 * CatalogueFilterPanel — the contents of the lane's Filter (`ui-lane-bar` filter button) popover, the
 * catalogue counterpart of the projects `FilterPanel`. It holds the service delivery-model facet (the
 * five models a service can be delivered as); products carry no delivery model, so the panel shows a
 * calm empty note for them. Kept dumb — the {@link CatalogueLane} island owns the applied model set and
 * commits the narrow client-side. Reuses the shared `.cat-model-pill` toggles (no new chrome).
 */
export interface CatalogueFilterPanelProps {
	type: CatalogueTypeFilter;
	/** The currently-engaged delivery models (OR-combined). */
	models: readonly ServiceType[];
	onToggleModel: (model: ServiceType) => void;
	onReset: () => void;
}

export function CatalogueFilterPanel(
	{ type, models, onToggleModel, onReset }: CatalogueFilterPanelProps,
): JSX.Element {
	const active = new Set(models);
	const showModels = type !== "product";
	return (
		<div class="cat-filter">
			<div class="cat-filter__head">
				<span class="cat-filter__title">
					<SlidersIcon size={16} /> Filters
				</span>
				{models.length > 0 && (
					<button type="button" class="cat-filter__reset" onClick={onReset}>
						Reset
					</button>
				)}
			</div>

			{showModels
				? (
					<div class="cat-filter__facet">
						<span class="cat-filter__facet-label">Delivery model</span>
						<div class="cat-lane__models" role="group" aria-label="Delivery model filters">
							{MODEL_OPTIONS.map((m) => {
								const on = active.has(m.value as ServiceType);
								return (
									<button
										key={m.value}
										type="button"
										class="cat-model-pill"
										data-on={on ? "true" : undefined}
										aria-pressed={on}
										onClick={() => onToggleModel(m.value as ServiceType)}
									>
										{m.label}
									</button>
								);
							})}
						</div>
					</div>
				)
				: <p class="cat-filter__empty">No filters for products yet.</p>}
		</div>
	);
}
