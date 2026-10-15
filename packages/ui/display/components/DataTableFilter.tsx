import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "../../fields/components/Button.tsx";
import { SelectionCheck } from "../../fields/components/SelectionCheck.tsx";
import { InputText } from "../../fields/islands/InputText.tsx";
import type { ColumnFilterSpec, ColumnFilterValue, FilterOption } from "../types/data-table.ts";
import { isFilterActive } from "../core/table-filter.ts";

/** Props for {@link DataTableFilter}. */
export interface DataTableFilterProps {
	header: string;
	spec: ColumnFilterSpec;
	value: ColumnFilterValue | undefined;
	/** `null` clears the column's filter. */
	onChange: (value: ColumnFilterValue | null) => void;
	options: readonly FilterOption[];
	/** Unit shown beside range inputs ("MB", "min"). */
	unit: string | null;
}

function parseBound(raw: string): number | null {
	if (raw.trim() === "") return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/** The filter editor for one column, shown in the header's filter popover. */
export function DataTableFilter(props: DataTableFilterProps): JSX.Element {
	const { header, spec, value, onChange, options, unit } = props;
	const resets = useSignal(0);
	const commit = (next: ColumnFilterValue) => onChange(isFilterActive(next) ? next : null);
	const clear = () => {
		resets.value++;
		onChange(null);
	};

	let editor: JSX.Element;
	switch (spec.kind) {
		case "text": {
			const query = value?.kind === "text" ? value.query : "";
			editor = (
				<InputText
					value={query}
					placeholder="Contains…"
					aria-label={`Filter ${header}`}
					type="search"
					enterKeyHint="search"
					autoFocus
					block
					onValueChange={(q) => commit({ kind: "text", query: q })}
				/>
			);
			break;
		}
		case "range": {
			const min = value?.kind === "range" ? value.min : null;
			const max = value?.kind === "range" ? value.max : null;
			editor = (
				<div class="ui-dt-filter__pair">
					<InputText
						value={min == null ? "" : String(min)}
						placeholder="Min"
						aria-label={`${header} at least`}
						type="number"
						end={unit ?? undefined}
						autoFocus
						onValueChange={(raw) => commit({ kind: "range", min: parseBound(raw), max })}
					/>
					<InputText
						value={max == null ? "" : String(max)}
						placeholder="Max"
						aria-label={`${header} at most`}
						type="number"
						end={unit ?? undefined}
						onValueChange={(raw) => commit({ kind: "range", min, max: parseBound(raw) })}
					/>
				</div>
			);
			break;
		}
		case "dateRange": {
			const from = value?.kind === "dateRange" ? value.from : null;
			const to = value?.kind === "dateRange" ? value.to : null;
			editor = (
				<div class="ui-dt-filter__pair">
					<InputText
						value={from ?? ""}
						aria-label={`${header} from`}
						type="date"
						autoFocus
						onValueChange={(raw) => commit({ kind: "dateRange", from: raw || null, to })}
					/>
					<InputText
						value={to ?? ""}
						aria-label={`${header} to`}
						type="date"
						onValueChange={(raw) => commit({ kind: "dateRange", from, to: raw || null })}
					/>
				</div>
			);
			break;
		}
		case "set": {
			const chosen = new Set(value?.kind === "set" ? value.values : []);
			const toggle = (option: string) => {
				const next = new Set(chosen);
				if (next.has(option)) next.delete(option);
				else next.add(option);
				commit({ kind: "set", values: [...next] });
			};
			editor = options.length === 0
				? <p class="ui-dt-filter__note">Nothing to filter by yet.</p>
				: (
					<div class="ui-dt-filter__options" role="group" aria-label={`Filter ${header}`}>
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								class="ui-dt-filter__option"
								role="checkbox"
								aria-checked={chosen.has(option.value)}
								onClick={() => toggle(option.value)}
							>
								<span class="ui-dt-filter__label">{option.label}</span>
								<SelectionCheck checked={chosen.has(option.value)} size="sm" />
							</button>
						))}
					</div>
				);
			break;
		}
	}

	return (
		<div class="ui-dt-filter">
			<p class="ui-dt-filter__title">{header}</p>
			<div class="ui-dt-filter__editor" key={resets.value}>{editor}</div>
			<div class="ui-dt-filter__foot">
				<Button
					variant="text"
					size="sm"
					disabled={!isFilterActive(value)}
					onClick={clear}
				>
					Clear
				</Button>
			</div>
		</div>
	);
}
