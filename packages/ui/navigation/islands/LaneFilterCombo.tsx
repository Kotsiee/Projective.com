import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/lane-filter.css";
import { Icon } from "../../icons/mod.ts";
import { useId } from "../../hooks/useId.ts";
import { LaneFilterFacet } from "../components/LaneFilter.tsx";

/** One entity a {@link LaneFilterCombo} can select. */
export interface LaneFilterComboOption {
	id: string;
	label: string;
}

/** Props for {@link LaneFilterCombo}. */
export interface LaneFilterComboProps {
	/** The facet caption ("Teams", "Workspaces & teams"); also names the field. */
	label: string;
	options: readonly LaneFilterComboOption[];
	/** Currently-selected ids; empty means no narrowing. */
	selected: readonly string[];
	onChange: (ids: string[]) => void;
	/** The field's placeholder while nothing is selected (default `"All"`). */
	emptyPlaceholder?: string;
}

/**
 * LaneFilterCombo — the lane filter's team / workspace selector: a text field filters the options,
 * Enter or a press confirms one as a small removable tag, Backspace on an empty field peels the last,
 * and Escape closes the list. Multi-select; an empty selection narrows nothing.
 */
export function LaneFilterCombo(props: LaneFilterComboProps): JSX.Element {
	const query = useSignal("");
	const open = useSignal(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId(undefined, "ui-lane-filter-combo");

	const chosen = props.options.filter((o) => props.selected.includes(o.id));
	const q = query.value.trim().toLowerCase();
	const matches = props.options.filter(
		(o) => !props.selected.includes(o.id) && (!q || o.label.toLowerCase().includes(q)),
	);
	const expanded = open.value && matches.length > 0;

	function add(id: string): void {
		if (!props.selected.includes(id)) props.onChange([...props.selected, id]);
		query.value = "";
		inputRef.current?.focus();
	}

	function remove(id: string): void {
		props.onChange(props.selected.filter((s) => s !== id));
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Enter" && matches.length > 0) {
			e.preventDefault();
			add(matches[0].id);
		} else if (e.key === "Backspace" && query.value === "" && chosen.length > 0) {
			remove(chosen[chosen.length - 1].id);
		} else if (e.key === "Escape" && open.value) {
			e.stopPropagation();
			open.value = false;
		}
	}

	return (
		<LaneFilterFacet label={props.label}>
			<div class="ui-lane-filter-combo">
				<div class="ui-lane-filter-combo__field">
					{chosen.map((o) => (
						<span key={o.id} class="ui-lane-filter-combo__tag">
							{o.label}
							<button
								type="button"
								class="ui-lane-filter-combo__remove"
								aria-label={`Remove ${o.label}`}
								onClick={() => remove(o.id)}
							>
								<Icon name="close" />
							</button>
						</span>
					))}
					<input
						ref={inputRef}
						class="ui-lane-filter-combo__input"
						type="text"
						role="combobox"
						aria-label={props.label}
						aria-expanded={expanded}
						aria-controls={listId}
						aria-autocomplete="list"
						placeholder={chosen.length ? "Add another…" : (props.emptyPlaceholder ?? "All")}
						value={query.value}
						onInput={(e) => {
							query.value = (e.target as HTMLInputElement).value;
							open.value = true;
						}}
						onFocus={() => (open.value = true)}
						onBlur={() => (open.value = false)}
						onKeyDown={onKeyDown}
					/>
				</div>
				<ul
					id={listId}
					class="ui-lane-filter-combo__menu"
					role="listbox"
					aria-label={props.label}
					hidden={!expanded}
				>
					{matches.map((o) => (
						<li key={o.id} role="option" aria-selected={false}>
							<button
								type="button"
								tabIndex={-1}
								class="ui-lane-filter-combo__option"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => add(o.id)}
							>
								{o.label}
							</button>
						</li>
					))}
				</ul>
			</div>
		</LaneFilterFacet>
	);
}
