/**
 * table-contract — the column-for-key check behind the `*-tables.contract.test.ts` files.
 *
 * `SYSTEM_ARCHITECTURE.md` holds the Zod SSOT to the database "1:1 with zero drift", and a
 * type-checker cannot see the database: SQL is a string to TypeScript. So a contract test reads the
 * consolidated migration FILES (never a live database, so it fails on a laptop the moment one side is
 * edited), lists each table's columns with {@link tableColumns}, and asks {@link columnDrift} for
 * every column with no Zod key and every Zod key with no column. Test support only: nothing in the
 * app imports it.
 */

// #region Migration text
const REPO = new URL("../../../", import.meta.url);

/** The text of a repository file, by its path from the repository root. */
export function readRepoFile(rel: string): string {
	return Deno.readTextFileSync(new URL(rel, REPO));
}

/** `sql` with its `--` line comments and `/* *\/` block comments blanked (string literals kept). */
function stripComments(sql: string): string {
	let out = "";
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		if (ch === "'") {
			const end = sql.indexOf("'", i + 1);
			const stop = end === -1 ? sql.length : end + 1;
			out += sql.slice(i, stop);
			i = stop;
		} else if (ch === "-" && sql[i + 1] === "-") {
			const end = sql.indexOf("\n", i);
			i = end === -1 ? sql.length : end;
		} else if (ch === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			i = end === -1 ? sql.length : end + 2;
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

/** The table-level clauses of a `CREATE TABLE` body: none of them is a column. */
const CLAUSE_KEYWORDS = new Set([
	"constraint",
	"primary",
	"unique",
	"check",
	"foreign",
	"exclude",
	"like",
]);

/**
 * The column names of `CREATE TABLE <name> (...)` in `sql`, in declaration order. The body is split
 * on its top-level commas (outside parentheses and string literals); a part that opens with a
 * table-level clause keyword is skipped, and every other part's first word is a column.
 * Throws when the table is not declared in `sql`.
 */
export function tableColumns(sql: string, name: string): string[] {
	const text = stripComments(sql);
	const head = new RegExp(
		`CREATE TABLE (?:IF NOT EXISTS )?${name.replace(".", "\\.")}\\s*\\(`,
		"i",
	);
	const match = head.exec(text);
	if (!match) throw new Error(`CREATE TABLE ${name} not found`);
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	let inString = false;
	for (let i = match.index + match[0].length; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			current += ch;
			if (ch === "'") inString = false;
			continue;
		}
		if (ch === "'") inString = true;
		if (ch === "(") depth++;
		if (ch === ")") {
			if (depth === 0) {
				parts.push(current);
				break;
			}
			depth--;
		}
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	return parts
		.map((part) => part.trim().split(/\s+/)[0]?.replace(/^"|"$/g, "") ?? "")
		.filter((word) => word !== "" && !CLAUSE_KEYWORDS.has(word.toLowerCase()));
}
// #endregion

// #region Drift
/**
 * `camelCase` → `snake_case`, the mapper's convention (`payerBusinessId` → `payer_business_id`,
 * `addressLine1` → `address_line_1`).
 */
export function snakeOf(key: string): string {
	return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`).replace(/(?<=[a-z])(\d+)/g, "_$1");
}

/** Where a Zod row schema and its table disagree. Both lists empty is zero drift. */
export interface ColumnDrift {
	/** Columns no Zod key maps to. */
	missingKeys: string[];
	/** Zod keys (as snake_case) no column backs, beyond the allowlisted derived fields. */
	extraKeys: string[];
}

/**
 * Compare a table's columns with a row schema's keys. `derived` names Zod keys (camelCase) that are
 * computed rather than stored; `rename` maps a Zod key to the column it reads when the two do not
 * follow {@link snakeOf} (`{ fxBase: "fx_base_currency" }`); `omitted` names columns the schema leaves
 * out on purpose (a secret the client never reads). Every allowlist entry must be used, so a stale
 * one fails too.
 */
export function columnDrift(
	columns: readonly string[],
	keys: readonly string[],
	allow: {
		derived?: readonly string[];
		rename?: Readonly<Record<string, string>>;
		omitted?: readonly string[];
	} = {},
): ColumnDrift & { staleAllowlist: string[] } {
	const derived = new Set(allow.derived ?? []);
	const rename = allow.rename ?? {};
	const omitted = new Set(allow.omitted ?? []);
	const columnSet = new Set(columns);
	const mapped = new Set<string>();
	const extraKeys: string[] = [];
	const staleAllowlist: string[] = [];
	for (const key of keys) {
		const column = rename[key] ?? snakeOf(key);
		if (columnSet.has(column)) {
			mapped.add(column);
			if (derived.has(key)) staleAllowlist.push(`derived:${key}`);
		} else if (!derived.has(key)) {
			extraKeys.push(column);
		}
	}
	for (const key of derived) if (!keys.includes(key)) staleAllowlist.push(`derived:${key}`);
	for (const key of Object.keys(rename)) {
		if (!keys.includes(key)) staleAllowlist.push(`rename:${key}`);
	}
	const missingKeys = columns.filter((column) => !mapped.has(column) && !omitted.has(column));
	for (const column of omitted) {
		if (!columnSet.has(column) || mapped.has(column)) staleAllowlist.push(`omitted:${column}`);
	}
	return { missingKeys, extraKeys, staleAllowlist };
}
// #endregion
