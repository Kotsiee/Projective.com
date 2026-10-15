import type { JSX, Ref } from "preact";
import { Icon } from "../../icons/mod.ts";
import { Button } from "../../fields/components/Button.tsx";
import { SelectionCheck } from "../../fields/components/SelectionCheck.tsx";
import { Popover } from "../../feedback/islands/Popover.tsx";
import type { DataColumn } from "../types/data-table.ts";

/** Props for {@link DataTableColumnMenu}. */
export interface DataTableColumnMenuProps<T> {
	/** Every column the viewer may show or hide, in display order. */
	columns: readonly DataColumn<T>[];
	hidden: readonly string[];
	onToggle: (columnId: string) => void;
	/** Restore the declared order, widths and visibility. */
	onReset: () => void;
}

/** The column chooser: show or hide columns, or reset the arrangement. */
export function DataTableColumnMenu<T>(props: DataTableColumnMenuProps<T>): JSX.Element {
	const shown = props.columns.filter((c) => !props.hidden.includes(c.id)).length;

	return (
		<Popover
			placement="bottom-end"
			label="Columns"
			trigger={(api) => (
				<button
					ref={api.ref as Ref<HTMLButtonElement>}
					type="button"
					class="ui-dt__action"
					aria-label="Choose columns"
					aria-haspopup="dialog"
					aria-expanded={api.expanded}
					aria-controls={api.expanded ? api.panelId : undefined}
					onClick={api.toggle}
				>
					<Icon name="table-grid" />
				</button>
			)}
		>
			<div class="ui-dt-filter">
				<p class="ui-dt-filter__title">Columns</p>
				<div class="ui-dt-filter__options" role="group" aria-label="Shown columns">
					{props.columns.map((column) => {
						const on = !props.hidden.includes(column.id);
						return (
							<button
								key={column.id}
								type="button"
								class="ui-dt-filter__option"
								role="checkbox"
								aria-checked={on}
								disabled={on && shown === 1}
								onClick={() => props.onToggle(column.id)}
							>
								<span class="ui-dt-filter__label">{column.header}</span>
								<SelectionCheck checked={on} size="sm" />
							</button>
						);
					})}
				</div>
				<div class="ui-dt-filter__foot">
					<Button variant="text" size="sm" onClick={props.onReset}>Reset columns</Button>
				</div>
			</div>
		</Popover>
	);
}
