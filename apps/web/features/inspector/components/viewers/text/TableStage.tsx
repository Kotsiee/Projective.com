import type { JSX } from "preact";
import { batch, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { INSPECT_TEXT_LIMITS } from "@projective/types/files";
import { TabStrip } from "@projective/ui/navigation";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { parseCsv } from "../../../core/csv.ts";
import { cellAddress } from "../../../core/sheet-window.ts";
import { openWorkbook, type Workbook, WorkbookError } from "../../../core/sheet-client.ts";
import type { ViewerProps } from "../viewer.ts";
import { SheetGrid } from "./SheetGrid.tsx";
import { tableFacts, type TableTools, truncationNotice } from "./text-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";
import { useTextSource } from "./use-text-source.ts";

/** Ask the panel to show and focus the table filter. */
export function requestFilterFocus(shell: InspectorShell, tools: TableTools): void {
	shell.panelOpen.value = true;
	tools.focus.value = true;
}

/** What is in the selected cell: its address, and its formula when it has one, else its value. */
function SheetBar({ tools }: { tools: TableTools }): JSX.Element | null {
	const table = tools.table.value;
	const focus = tools.cursor.value?.focus;
	if (!table) return null;
	const source = focus ? tools.order.value[focus.row] : undefined;
	const formula = source === undefined || !focus
		? undefined
		: tools.formulas.value[`${source}:${focus.column}`];
	const value = source === undefined || !focus ? "" : table.rows[source]?.[focus.column] ?? "";
	return (
		<div class="ins-grid-bar" role="group" aria-label="Selected cell">
			<span class="ins-grid-bar__ref">
				{source === undefined || !focus ? "–" : cellAddress(source, focus.column)}
			</span>
			<span class="ins-grid-bar__mark" data-on={formula ? "true" : undefined} aria-hidden="true">
				fx
			</span>
			<output class="ins-grid-bar__value">{formula ?? value}</output>
		</div>
	);
}

/**
 * Everything around the grid for a CSV or a sheet alike: the truncation notice, the cell bar, the
 * grid and, for a workbook, its sheet tabs.
 */
function SheetView({ shell, tools }: ViewerProps<TableTools>): JSX.Element {
	const root = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLDivElement>(null);

	useSignalEffect(() => {
		const table = tools.table.value;
		if (!table) return;
		shell.facts.value = tableFacts(
			table,
			tools.header.value,
			tools.delimiter,
			tools.sheets.value.length,
		);
		if (shell.status.peek() === "loading") shell.status.value = "ready";
	});

	// Filtering or sorting moves every row under the cursor, so the selection would mean nothing.
	useSignalEffect(() => {
		void tools.order.value;
		tools.cursor.value = null;
	});

	useStageKeys(root, grid, (event) => {
		const mod = event.ctrlKey || event.metaKey;
		if (!mod || event.altKey || (event.key !== "f" && event.key !== "F")) return false;
		requestFilterFocus(shell, tools);
		return true;
	});

	const table = tools.table.value;
	if (!table) return <div ref={root} class="ins-grid" aria-hidden="true" />;

	const filter = tools.filter.value.trim();
	const notice = truncationNotice(table, tools.header.value);
	const sheets = tools.sheets.value;

	return (
		<div ref={root} class="ins-grid">
			{notice ? <p class="ins-grid__notice">{notice}</p> : null}
			<SheetBar tools={tools} />
			<SheetGrid shell={shell} tools={tools} gridRef={grid} />
			{tools.order.value.length === 0
				? (
					<p class="ins-grid__empty">
						{filter.length > 0 ? `No rows contain “${filter}”.` : "This sheet has no rows."}
					</p>
				)
				: null}
			{sheets.length > 1
				? (
					<TabStrip
						class="ins-grid__tabs"
						tone="lane"
						label="Sheets"
						activeKey={String(tools.sheetIndex.value)}
						items={sheets.map((name, i) => ({ key: String(i), label: name }))}
						onSelect={(key) => (tools.sheetIndex.value = Number(key))}
					/>
				)
				: null}
		</div>
	);
}

/** The CSV/TSV canvas: the file is read as text and parsed here. */
export function TableStage({ shell, tools }: ViewerProps<TableTools>): JSX.Element {
	useTextSource(shell, tools.text, (text) => {
		tools.table.value = parseCsv(text, {
			delimiter: tools.delimiter ?? ",",
			maxRows: INSPECT_TEXT_LIMITS.tableRows + 1,
		});
	});
	return <SheetView shell={shell} tools={tools} />;
}

function failure(error: unknown): string {
	return error instanceof WorkbookError && error.failure === "password"
		? "This workbook is password-protected, so it can't be previewed here."
		: "This file isn't a readable workbook. It may be damaged or only named like one.";
}

/**
 * The workbook canvas: the file is fetched here and parsed in a worker, then each sheet crosses the
 * thread boundary when its tab is first opened.
 */
export function WorkbookStage({ shell, tools }: ViewerProps<TableTools>): JSX.Element {
	const book = useRef<Workbook | null>(null);

	async function show(index: number): Promise<void> {
		const open = book.current;
		if (!open) return;
		const sheet = await open.sheet(index);
		if (book.current !== open) return;
		batch(() => {
			tools.sort.value = null;
			tools.filter.value = "";
			tools.formulas.value = sheet.formulas;
			tools.widths.value = sheet.widths;
			tools.table.value = sheet;
		});
	}

	useEffect(() => {
		if (shell.status.peek() === "error") return;
		const controller = new AbortController();
		(async () => {
			const res = await fetch(shell.asset.src, {
				signal: controller.signal,
				credentials: "same-origin",
			});
			if (!res.ok) {
				await res.body?.cancel();
				shell.fail(
					res.status === 404
						? "This file is no longer available."
						: "This file couldn't be loaded.",
				);
				return;
			}
			const opened = await openWorkbook(await res.arrayBuffer());
			if (controller.signal.aborted) return opened.close();
			book.current = opened;
			tools.sheets.value = opened.names;
			await show(0);
		})().catch((error: unknown) => {
			if (!controller.signal.aborted) shell.fail(failure(error));
		});
		return () => {
			controller.abort();
			book.current?.close();
			book.current = null;
		};
	}, [shell]);

	const shown = useRef(0);
	useSignalEffect(() => {
		const index = tools.sheetIndex.value;
		if (index === shown.current) return;
		shown.current = index;
		show(index).catch(() => shell.announce("That sheet couldn't be opened."));
	});

	return <SheetView shell={shell} tools={tools} />;
}
