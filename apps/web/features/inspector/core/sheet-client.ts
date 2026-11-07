/// <reference lib="dom" />
import { INSPECT_SHEET_LIMITS } from "@projective/types/files";
import type { SheetData, WorkbookFailure, WorkbookOptions } from "./sheet-read.ts";
import type { SheetRequest, SheetResponse } from "./sheet-worker.ts";

/**
 * sheet-client — the page's side of `sheet-worker.ts`. Types only cross this import, so neither
 * SheetJS nor the parser enters a page's bundle: both load with the worker, the first time a workbook
 * is opened.
 */

/** A workbook open in its own worker. */
export interface Workbook {
	readonly names: readonly string[];
	sheet(index: number): Promise<SheetData>;
	/** End the worker and free the parse. */
	close(): void;
}

/** Why {@link openWorkbook} failed. */
export class WorkbookError extends Error {
	readonly failure: WorkbookFailure;

	constructor(failure: WorkbookFailure) {
		super(failure);
		this.name = "WorkbookError";
		this.failure = failure;
	}
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Parse a workbook off the main thread. The bytes are transferred, not copied. */
export function openWorkbook(bytes: ArrayBuffer, options: WorkbookOptions = {}): Promise<Workbook> {
	const worker = new Worker(new URL("./sheet-worker.ts", import.meta.url), { type: "module" });
	const pending = new Map<number, (response: SheetResponse) => void>();
	let sequence = 0;

	const fail = () => {
		for (const settle of pending.values()) settle({ id: 0, kind: "failed", failure: "unreadable" });
		pending.clear();
	};
	worker.addEventListener("message", (event: MessageEvent<SheetResponse>) => {
		pending.get(event.data.id)?.(event.data);
		pending.delete(event.data.id);
	});
	worker.addEventListener("error", fail);

	const ask = (request: DistributiveOmit<SheetRequest, "id">, transfer: Transferable[] = []) =>
		new Promise<SheetResponse>((resolve) => {
			sequence += 1;
			pending.set(sequence, resolve);
			worker.postMessage({ ...request, id: sequence }, transfer);
		});

	const close = () => {
		worker.terminate();
		fail();
	};

	const open = { kind: "open", bytes, options, limits: INSPECT_SHEET_LIMITS } as const;
	return ask(open, [bytes]).then((opened) => {
		if (opened.kind !== "opened") {
			close();
			throw new WorkbookError(opened.kind === "failed" ? opened.failure : "unreadable");
		}
		return {
			names: opened.names,
			close,
			sheet: async (index) => {
				const answer = await ask({ kind: "sheet", index });
				if (answer.kind !== "sheet") throw new WorkbookError("unreadable");
				return answer.sheet;
			},
		};
	});
}
