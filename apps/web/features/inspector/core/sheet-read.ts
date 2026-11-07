import { read, utils, type WorkBook, type WorkSheet } from "@e965/xlsx";

/**
 * sheet-read — a workbook's bytes as plain rows. SheetJS is reached ONLY from here, and this module
 * ONLY from `sheet-worker.ts` (and the tests): the library parses files strangers uploaded, so it runs
 * where a fault has no DOM to touch, and the main thread never pays for the parse or the bundle.
 *
 * Nothing from the workspace is imported here: Vite bundles a worker on its own at build, with only
 * `node_modules` resolution, so an import-map alias works in dev and breaks the production build.
 */

// #region Contract
/** One sheet, flattened to what a grid draws. */
export interface SheetData {
	name: string;
	/** Display text by row, then column; `rows[r][c]` is the cell at row `r + 1`, column `c`. */
	rows: string[][];
	/** Rows held; every row has at most this sheet's {@link columns}. */
	columns: number;
	/** Rows in the sheet, counting any past the ceiling. */
	totalRows: number;
	truncated: boolean;
	/** The formula behind a cell, keyed `row:column`, with its leading `=`. */
	formulas: Record<string, string>;
	/** Declared column widths in px; null where the file left a column to its default. */
	widths: (number | null)[];
}

/** The most of a sheet that is kept. */
export interface SheetLimits {
	/** Rows kept before a sheet is truncated. */
	rows: number;
	/** Columns kept, so one stray cell far to the right cannot size a sheet at 16,384 columns. */
	columns: number;
}

/** Options for {@link parseWorkbook}. */
export interface WorkbookOptions {
	/** Read only this many rows of the first sheet: the card preview's fast path. */
	previewRows?: number;
}

/** Why a workbook could not be read, as something a person can act on. */
export type WorkbookFailure = "password" | "unreadable";

/** Thrown by {@link parseWorkbook}. */
export class WorkbookReadError extends Error {
	readonly failure: WorkbookFailure;

	constructor(failure: WorkbookFailure, options?: ErrorOptions) {
		super(failure, options);
		this.name = "WorkbookReadError";
		this.failure = failure;
	}
}
// #endregion

// #region Parse
const NOT_PARSED = {
	cellHTML: false,
	cellNF: false,
	bookVBA: false,
	bookFiles: false,
	bookDeps: false,
	bookProps: false,
} as const;

const HEAD_BYTES = 512;

/**
 * Whether these bytes could be a workbook at all: a ZIP, an OLE compound file, a BIFF stream, or text
 * (a CSV or HTML table saved as `.xls`, which is common). SheetJS reads anything else as delimited
 * text, so without this a damaged file opens as a sheet of noise instead of saying it is damaged.
 */
export function looksLikeWorkbook(bytes: Uint8Array): boolean {
	const [a, b, c, d] = bytes;
	if (a === 0x50 && b === 0x4b) return true;
	if (a === 0xd0 && b === 0xcf && c === 0x11 && d === 0xe0) return true;
	if (a === 0x09 && (b === 0x00 || b === 0x02 || b === 0x04 || b === 0x08)) return true;
	return bytes.length > 0 && bytes.subarray(0, HEAD_BYTES).every((byte) => byte >= 0x09);
}

/** Parse a workbook. Rejects with {@link WorkbookReadError}. */
export function parseWorkbook(bytes: ArrayBuffer, options: WorkbookOptions = {}): WorkBook {
	const preview = options.previewRows;
	if (!looksLikeWorkbook(new Uint8Array(bytes))) throw new WorkbookReadError("unreadable");
	try {
		return read(new Uint8Array(bytes), {
			type: "array",
			dense: true,
			cellFormula: preview === undefined,
			cellText: true,
			// SheetJS keeps `!cols` only with styles on; a card has no use for declared widths.
			cellStyles: preview === undefined,
			...NOT_PARSED,
			...(preview === undefined ? {} : { sheetRows: preview, sheets: 0 }),
		});
	} catch (error) {
		const failure = /password|encrypt/i.test(String(error)) ? "password" : "unreadable";
		throw new WorkbookReadError(failure, { cause: error });
	}
}

/** The tabs a person would see: hidden sheets stay hidden, unless every sheet is. */
export function visibleSheetNames(book: WorkBook): string[] {
	const states = book.Workbook?.Sheets;
	const shown = book.SheetNames.filter((_, i) => !states?.[i]?.Hidden);
	return shown.length > 0 ? shown : [...book.SheetNames];
}
// #endregion

// #region Projection
const PX_PER_CHAR = 7;

interface DenseCell {
	t?: string;
	v?: unknown;
	w?: string;
	f?: string;
}

function cellText(cell: DenseCell): string {
	if (cell.w !== undefined) return cell.w;
	if (cell.v === undefined || cell.v === null) return "";
	return cell.t === "b" ? (cell.v ? "TRUE" : "FALSE") : String(cell.v);
}

function widthOf(sheet: WorkSheet, column: number): number | null {
	const declared = sheet["!cols"]?.[column];
	if (!declared) return null;
	if (declared.hidden) return 0;
	return declared.wpx ?? (declared.wch === undefined ? null : declared.wch * PX_PER_CHAR);
}

/** Flatten one parsed sheet, from A1, inside the ceilings. */
export function projectSheet(name: string, sheet: WorkSheet, limits: SheetLimits): SheetData {
	const ref = sheet["!ref"];
	if (!ref) {
		return { name, rows: [], columns: 0, totalRows: 0, truncated: false, formulas: {}, widths: [] };
	}
	const range = utils.decode_range(ref);
	const data = (sheet["!data"] ?? []) as (DenseCell[] | undefined)[];
	const lastRow = Math.min(range.e.r, limits.rows - 1);
	const lastColumn = Math.min(range.e.c, limits.columns - 1);
	const rows: string[][] = [];
	const formulas: Record<string, string> = {};
	let columns = 0;
	for (let r = 0; r <= lastRow; r++) {
		const source = data[r];
		const row: string[] = [];
		if (source) {
			const end = Math.min(source.length - 1, lastColumn);
			for (let c = 0; c <= end; c++) {
				const cell = source[c];
				if (!cell) continue;
				while (row.length < c) row.push("");
				row.push(cellText(cell));
				if (cell.f) formulas[`${r}:${c}`] = `=${cell.f}`;
			}
		}
		if (row.length > columns) columns = row.length;
		rows.push(row);
	}
	return {
		name,
		rows,
		columns,
		totalRows: range.e.r + 1,
		truncated: range.e.r > lastRow,
		formulas,
		widths: Array.from({ length: columns }, (_, c) => widthOf(sheet, c)),
	};
}
// #endregion
