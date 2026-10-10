import type { JSX } from "preact";
import { useSignalEffect } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { headerCells } from "../../../core/csv.ts";
import { ToolGroup, ToolReadout, ToolToggle } from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import { formatCount, type TableTools } from "./text-tools.ts";

const FILTER_ID = "ins-table-filter";

/** The table canvas's panel controls: header row, filter and sorting. */
export function TableControls({ shell, tools }: ViewerProps<TableTools>): JSX.Element {
	useSignalEffect(() => {
		if (!tools.focus.value) return;
		const timer = setTimeout(() => {
			tools.focus.value = false;
			const field = document.getElementById(FILTER_ID);
			if (field instanceof HTMLInputElement && document.activeElement !== field) {
				field.focus();
				field.select();
			}
		}, 0);
		return () => clearTimeout(timer);
	});

	const table = tools.table.value;
	const header = tools.header.value;
	const sort = tools.sort.value;
	const shown = tools.order.value.length;
	const total = table
		? Math.max(0, table.rows.length - (header && table.rows.length > 0 ? 1 : 0))
		: 0;
	const sortedBy = table && sort ? headerCells(table, header)[sort.column] ?? null : null;

	return (
		<>
			<ToolGroup title="Table">
				<ToolToggle label="First row is the header" value={tools.header} disabled={!table} />
			</ToolGroup>
			<ToolGroup title="Filter">
				<InputText
					id={FILTER_ID}
					type="search"
					size="sm"
					fluid
					value={tools.filter}
					onKeyDown={(event) => {
						if (event.key !== "Escape" || tools.filter.peek().length === 0) return;
						event.preventDefault();
						tools.filter.value = "";
					}}
					placeholder="Filter rows"
					aria-label="Filter rows"
					autoComplete="off"
					spellcheck={false}
					disabled={!table}
					start={<Icon name="filter" size="sm" />}
				/>
				<ToolReadout
					value={table ? `${formatCount(shown)} of ${formatCount(total)} rows` : "–"}
					label="Rows shown"
				/>
			</ToolGroup>
			{sortedBy !== null && sort
				? (
					<ToolGroup title="Sorting">
						<p class="ins-text-note">
							{`By ${sortedBy}, ${sort.direction}. Press a column header to change it.`}
						</p>
						<div class="ins-text-actions">
							<Button
								size="sm"
								severity="neutral"
								variant="outlined"
								icon={<Icon name="close" size="sm" />}
								label="Clear sorting"
								onClick={() => {
									tools.sort.value = null;
									shell.announce("Sorting cleared");
								}}
							/>
						</div>
					</ToolGroup>
				)
				: null}
		</>
	);
}
