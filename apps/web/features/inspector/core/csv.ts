/**
 * csv — an RFC 4180 reader and the pure table decisions behind the inspector's table canvas:
 * column labels, ordering and filtering. No DOM, no library.
 */

// #region Parse
/** Options for {@link parseCsv}. */
export interface CsvOptions {
	/** One-character cell separator; `,` by default (`\t` for TSV). */
	delimiter?: string;
	/** Rows kept in memory; the rest are only counted. */
	maxRows?: number;
}

/** A parsed table. `rows` holds at most `maxRows` records; `totalRows` counts every one. */
export interface CsvTable {
	rows: string[][];
	totalRows: number;
	/** The widest record's cell count. */
	columns: number;
	truncated: boolean;
}

function fieldEnd(text: string, from: number, delimiter: string): number {
	let k = from;
	while (k < text.length) {
		const ch = text[k];
		if (ch === delimiter || ch === "\n" || ch === "\r") break;
		k++;
	}
	return k;
}

/**
 * Parse delimiter-separated text per RFC 4180: quoted cells may hold the delimiter, line breaks and
 * doubled quotes (`""`); records end at CRLF, LF or CR; a leading BOM is dropped; blank lines are
 * skipped. Lenient where the RFC is silent: an unterminated quote runs to the end of the text, and
 * stray characters after a closing quote are kept.
 */
export function parseCsv(text: string, opts: CsvOptions = {}): CsvTable {
	const delimiter = opts.delimiter && opts.delimiter.length === 1 ? opts.delimiter : ",";
	const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;
	const rows: string[][] = [];
	let totalRows = 0;
	let columns = 0;
	let row: string[] = [];
	let rowQuoted = false;
	const n = text.length;
	let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

	const endRow = () => {
		if (row.length === 1 && row[0] === "" && !rowQuoted) {
			row = [];
			return;
		}
		totalRows++;
		if (row.length > columns) columns = row.length;
		if (rows.length < maxRows) rows.push(row);
		row = [];
		rowQuoted = false;
	};

	while (i < n) {
		let value: string;
		if (text[i] === '"') {
			rowQuoted = true;
			let quoted = "";
			let segment = i + 1;
			let j = segment;
			for (;;) {
				const quote = text.indexOf('"', j);
				if (quote === -1) {
					quoted += text.slice(segment);
					j = n;
					break;
				}
				if (text[quote + 1] === '"') {
					quoted += text.slice(segment, quote + 1);
					j = quote + 2;
					segment = j;
					continue;
				}
				quoted += text.slice(segment, quote);
				j = quote + 1;
				break;
			}
			const end = fieldEnd(text, j, delimiter);
			value = quoted + text.slice(j, end);
			i = end;
		} else {
			const end = fieldEnd(text, i, delimiter);
			value = text.slice(i, end);
			i = end;
		}
		row.push(value);
		if (i >= n) break;
		if (text[i] === delimiter) {
			i++;
			if (i >= n) row.push("");
			continue;
		}
		i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
		endRow();
	}
	if (row.length > 0) endRow();
	return { rows, totalRows, columns, truncated: totalRows > rows.length };
}
// #endregion

// #region Columns
/** Spreadsheet-style label for a 0-based column: A…Z, AA…AZ, BA… */
export function columnLabel(index: number): string {
	let n = Math.max(0, Math.trunc(index)) + 1;
	let label = "";
	while (n > 0) {
		const rem = (n - 1) % 26;
		label = String.fromCharCode(65 + rem) + label;
		n = Math.floor((n - 1) / 26);
	}
	return label;
}

/** The header cells: the first record's cells when it is a header, else letters; padded to `columns`. */
export function headerCells(
	table: Pick<CsvTable, "rows" | "columns">,
	firstRowIsHeader: boolean,
): string[] {
	const first = firstRowIsHeader ? table.rows[0] ?? [] : [];
	return Array.from({ length: table.columns }, (_, i) => {
		const cell = (first[i] ?? "").trim();
		return cell.length > 0 ? cell : columnLabel(i);
	});
}
// #endregion

// #region Order & filter
/** A column ordering. */
export interface TableSort {
	column: number;
	direction: "ascending" | "descending";
}

/** The next ordering when a column header is pressed: ascending → descending → none. */
export function nextSort(current: TableSort | null, column: number): TableSort | null {
	if (!current || current.column !== column) return { column, direction: "ascending" };
	if (current.direction === "ascending") return { column, direction: "descending" };
	return null;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

function numericValue(cell: string): number | null {
	const trimmed = cell.trim().replace(/,(?=\d{3}(\D|$))/g, "");
	return NUMERIC.test(trimmed) ? Number(trimmed) : null;
}

/** Whether a cell holds a plain number (`1,250.5`, `-3`, `2e6`), so it can align to the end. */
export function isNumericCell(cell: string): boolean {
	return numericValue(cell) !== null;
}

/** Order two cells: numerically when both are numbers, else by natural text order; blanks last. */
export function compareCells(a: string, b: string): number {
	const aBlank = a.trim().length === 0;
	const bBlank = b.trim().length === 0;
	if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
	const an = numericValue(a);
	const bn = numericValue(b);
	if (an !== null && bn !== null) return an - bn;
	return COLLATOR.compare(a, b);
}

/**
 * The body rows to show, as indexes into `rows`: the header record left out, rows not containing
 * `filter` (case-insensitive) dropped, then ordered by `sort` (stable; blanks stay last).
 */
export function tableRowOrder(
	rows: readonly (readonly string[])[],
	opts: { firstRowIsHeader: boolean; filter: string; sort: TableSort | null },
): number[] {
	const needle = opts.filter.trim().toLowerCase();
	const order: number[] = [];
	for (let i = opts.firstRowIsHeader ? 1 : 0; i < rows.length; i++) {
		if (needle.length === 0 || rows[i].some((cell) => cell.toLowerCase().includes(needle))) {
			order.push(i);
		}
	}
	const sort = opts.sort;
	if (sort) {
		const sign = sort.direction === "ascending" ? 1 : -1;
		order.sort((x, y) => {
			const a = rows[x][sort.column] ?? "";
			const b = rows[y][sort.column] ?? "";
			const blank = (a.trim().length === 0 ? 1 : 0) - (b.trim().length === 0 ? 1 : 0);
			if (blank !== 0) return blank;
			return sign * compareCells(a, b) || x - y;
		});
	}
	return order;
}
// #endregion
