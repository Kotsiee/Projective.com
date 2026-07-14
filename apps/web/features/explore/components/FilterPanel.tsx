import type { JSX } from "preact";
import { Select } from "@projective/ui/fields";
import { vars } from "@features/marketing/core/style.ts";
import type { FilterGroup } from "../core/filter-config.ts";
import type { ExploreCategory } from "../types/explore-types.ts";

/**
 * FilterPanel — the adaptive, collapsible sidebar filters. It is fully controlled by the parent
 * dashboard island (the `values` map + callbacks), so the rendered state always matches the URL; the
 * facet groups come from `FILTER_CONFIG[category]`, so switching category swaps the available facets
 * with no branching here. Collapse uses native `<details>` (accessible, zero-JS). Controls are native,
 * token-styled, and controlled — reliable across the island's re-renders. Reused verbatim inside the
 * mobile filter drawer.
 */
export interface FilterPanelProps {
	category: ExploreCategory;
	groups: FilterGroup[];
	values: Record<string, string[]>;
	onToggle: (id: string, value: string) => void;
	onSetRange: (id: string, value: number) => void;
	onSetSelect: (id: string, value: string) => void;
	onClear: () => void;
	activeCount: number;
}

export function FilterPanel(props: FilterPanelProps): JSX.Element {
	const { groups, values, onToggle, onSetRange, onSetSelect, onClear, activeCount } = props;
	return (
		<div class="ex-filters">
			<div class="ex-filters__head">
				<h2 class="ex-filters__title">Filters</h2>
				{activeCount > 0 && (
					<button type="button" class="ex-filters__clear" onClick={onClear}>
						Clear all
					</button>
				)}
			</div>

			{groups.map((g) => (
				<details class="ex-filters__group" key={g.id} open>
					<summary class="ex-filters__summary">
						<span>{g.label}</span>
						<span class="ex-filters__chevron" aria-hidden="true" />
					</summary>
					<div class="ex-filters__body">
						{(g.control === "chips" || g.control === "checkbox") && (
							<div class={g.control === "chips" ? "ex-filters__chips" : "ex-filters__checks"}>
								{g.options?.map((opt) => {
									const active = values[g.id]?.includes(opt.value) ?? false;
									return (
										<button
											type="button"
											key={opt.value}
											class={`ex-filters__opt ex-filters__opt--${g.control}`}
											aria-pressed={active}
											onClick={() => onToggle(g.id, opt.value)}
										>
											{g.control === "checkbox" && (
												<span class="ex-filters__box" aria-hidden="true" />
											)}
											{opt.label}
										</button>
									);
								})}
							</div>
						)}

						{g.control === "select" && (
							<Select
								class="ex-filters__select"
								size="sm"
								aria-label={g.label}
								key={`${g.id}:${values[g.id]?.[0] ?? ""}`}
								options={[{ label: "Any", value: "" }, ...(g.options ?? [])]}
								value={values[g.id]?.[0] ?? ""}
								onValueChange={(v) => onSetSelect(g.id, v)}
							/>
						)}

						{g.control === "range" && (
							<div class="ex-filters__range">
								<input
									type="range"
									class="ex-filters__slider"
									min={g.min ?? 0}
									max={g.max ?? 100}
									step={g.step ?? 1}
									value={values[g.id]?.[0] ?? String(g.max ?? 100)}
									aria-label={g.label}
									style={vars({
										"--ex-range": `${
											((Number(values[g.id]?.[0] ?? (g.max ?? 100)) - (g.min ?? 0)) /
												((g.max ?? 100) - (g.min ?? 0))) * 100
										}%`,
									})}
									onInput={(e) =>
										onSetRange(g.id, Number((e.currentTarget as HTMLInputElement).value))}
								/>
								<span class="ex-filters__rangeval">
									up to {g.unit === "$" ? "$" : ""}
									{Number(values[g.id]?.[0] ?? (g.max ?? 100)).toLocaleString("en-US")}
									{g.unit && g.unit !== "$" ? ` ${g.unit}` : ""}
								</span>
							</div>
						)}
					</div>
				</details>
			))}
		</div>
	);
}
