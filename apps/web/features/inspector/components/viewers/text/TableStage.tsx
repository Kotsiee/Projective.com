import type { JSX } from "preact";
import { useComputed, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import { INSPECT_TEXT_LIMITS } from "@projective/types/files";
import { Icon } from "@projective/ui/icons";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { escapeHtml } from "../../../core/code-lines.ts";
import { headerCells, isNumericCell, nextSort, parseCsv } from "../../../core/csv.ts";
import type { ViewerProps } from "../viewer.ts";
import { tableFacts, type TableTools, truncationNotice } from "./text-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";
import { useTextSource } from "./use-text-source.ts";

/** Ask the panel to show and focus the table filter. */
export function requestFilterFocus(shell: InspectorShell, tools: TableTools): void {
	shell.panelOpen.value = true;
	tools.focus.value = true;
}

/**
 * The CSV/TSV canvas: a table with a sticky header row and row-number column, sortable columns
 * (header buttons cycle ascending, descending, none) and the panel's filter applied. Rows past the
 * render ceiling are counted, not drawn, and a notice says so.
 */
export function TableStage({ shell, tools }: ViewerProps<TableTools>): JSX.Element {
	const scroller = useRef<HTMLDivElement>(null);
	useTextSource(shell, tools.text, (text) => {
		tools.table.value = parseCsv(text, {
			delimiter: tools.delimiter,
			maxRows: INSPECT_TEXT_LIMITS.tableRows + 1,
		});
	});

	useSignalEffect(() => {
		const table = tools.table.value;
		if (!table) return;
		shell.facts.value = tableFacts(table, tools.header.value, tools.delimiter);
		if (shell.status.peek() === "loading") shell.status.value = "ready";
	});

	const bodyHtml = useComputed(() => {
		const table = tools.table.value;
		if (!table) return "";
		const header = tools.header.value;
		let out = "";
		for (const index of tools.order.value) {
			const row = table.rows[index];
			out += `<tr><th scope="row" class="ins-table__num">${header ? index : index + 1}</th>`;
			for (let c = 0; c < table.columns; c++) {
				const cell = row[c] ?? "";
				out += isNumericCell(cell)
					? '<td class="ins-table__cell ins-table__cell--num">'
					: '<td class="ins-table__cell">';
				out += `${escapeHtml(cell)}</td>`;
			}
			out += "</tr>";
		}
		return out;
	});

	useStageKeys(scroller, scroller, (event) => {
		const mod = event.ctrlKey || event.metaKey;
		if (!mod || event.altKey || (event.key !== "f" && event.key !== "F")) return false;
		requestFilterFocus(shell, tools);
		return true;
	});

	const table = tools.table.value;
	if (!table) return <div ref={scroller} class="ins-table" aria-hidden="true" />;

	const header = tools.header.value;
	const sort = tools.sort.value;
	const shown = tools.order.value.length;
	const filter = tools.filter.value.trim();
	const notice = truncationNotice(table, header);
	const headers = headerCells(table, header);

	return (
		<div ref={scroller} class="ins-table">
			{notice ? <p class="ins-table__notice">{notice}</p> : null}
			<table class="ins-table__grid">
				<thead>
					<tr>
						<th scope="col" class="ins-table__corner">
							<span class="ui-visually-hidden">Row</span>
						</th>
						{headers.map((label, column) => {
							const direction = sort?.column === column ? sort.direction : null;
							return (
								<th
									key={column}
									scope="col"
									class="ins-table__head"
									aria-sort={direction ?? undefined}
								>
									<button
										type="button"
										class="ins-table__sort"
										onClick={() => {
											const next = nextSort(tools.sort.peek(), column);
											tools.sort.value = next;
											shell.announce(
												next
													? `Sorted by ${label}, ${next.direction}`
													: `Sorting by ${label} cleared`,
											);
										}}
									>
										<span class="ins-table__label">{label}</span>
										<span class="ins-table__sort-mark" aria-hidden="true">
											<Icon
												name={direction === "ascending"
													? "sort-asc"
													: direction === "descending"
													? "sort-desc"
													: "sort"}
												size="xs"
											/>
										</span>
									</button>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody dangerouslySetInnerHTML={{ __html: bodyHtml.value }} />
			</table>
			{shown === 0
				? (
					<p class="ins-table__empty">
						{filter.length > 0 ? `No rows contain “${filter}”.` : "This file has no rows."}
					</p>
				)
				: null}
		</div>
	);
}
