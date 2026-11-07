import type { WorkBook } from "@e965/xlsx";
import {
	parseWorkbook,
	projectSheet,
	type SheetData,
	type SheetLimits,
	visibleSheetNames,
	type WorkbookFailure,
	type WorkbookOptions,
	WorkbookReadError,
} from "./sheet-read.ts";

/**
 * sheet-worker — the Web Worker that parses workbooks. In `core/`, not `islands/`, for the reason
 * `files/core/hash-worker.ts` gives: Vite registers anything under an `islands` folder as an island.
 *
 * One workbook per worker: it is parsed once on `open` and held here, and a tab asks for its sheet,
 * so a many-sheet file does not cross the thread boundary all at once.
 */

// #region Protocol
/** A message posted into the worker. */
export type SheetRequest =
	| {
		id: number;
		kind: "open";
		bytes: ArrayBuffer;
		options: WorkbookOptions;
		limits: SheetLimits;
	}
	| { id: number; kind: "sheet"; index: number };

/** A message posted back. */
export type SheetResponse =
	| { id: number; kind: "opened"; names: string[] }
	| { id: number; kind: "sheet"; sheet: SheetData }
	| { id: number; kind: "failed"; failure: WorkbookFailure };
// #endregion

interface WorkerScope {
	addEventListener(type: "message", listener: (event: MessageEvent<SheetRequest>) => void): void;
	postMessage(message: SheetResponse): void;
}

const scope = globalThis as unknown as WorkerScope;
let book: WorkBook | null = null;
let names: string[] = [];
let limits: SheetLimits = { rows: Infinity, columns: Infinity };

function answer(request: SheetRequest): SheetResponse {
	if (request.kind === "open") {
		book = parseWorkbook(request.bytes, request.options);
		names = visibleSheetNames(book);
		limits = request.limits;
		return { id: request.id, kind: "opened", names };
	}
	const name = names[request.index];
	const sheet = name === undefined ? undefined : book?.Sheets[name];
	if (!sheet) return { id: request.id, kind: "failed", failure: "unreadable" };
	return { id: request.id, kind: "sheet", sheet: projectSheet(name, sheet, limits) };
}

scope.addEventListener("message", (event) => {
	const request = event.data;
	try {
		scope.postMessage(answer(request));
	} catch (error) {
		const failure = error instanceof WorkbookReadError ? error.failure : "unreadable";
		scope.postMessage({ id: request.id, kind: "failed", failure });
	}
});
