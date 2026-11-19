/**
 * `deno task release:guard <delta.sql> [...]` holds a hosted schema delta to the Additive Rule before
 * it is applied (root CLAUDE.md §1, SYSTEM_ARCHITECTURE.md §1 "The Additive Rule";
 * OPERATIONS_BUILD_PROMPTS.md OPS6 step 3, Decision #512; the release order is in
 * documentation/architecture/DEPLOYMENT_RUNBOOK.md).
 *
 * It refuses a file that drops or renames a table, schema or column, drops a constraint (offline, a
 * foreign key cannot be told apart from any other constraint), or alters `finance.escrows`,
 * `finance.wallets` or `projects.project_stages` at all, unless the file carries one approval line:
 *
 *     -- additive-rule-approved: Decision #NNN by <name> on YYYY-MM-DD
 *
 * naming a decision the index (`documentation/reference/decisions/README.md`) holds and the human
 * who approved it. Comments are ignored when scanning, so a commented-out statement never counts,
 * and string literals and function bodies are scanned, so `EXECUTE 'DROP TABLE …'` inside a `DO`
 * block does. Read-only and offline: it runs with `--allow-read` only.
 *
 * Exit codes: 0 nothing destructive, or every finding approved · 1 an unapproved finding, or a
 * malformed approval · 2 cannot run (no file, an unreadable file or index).
 */

// #region Rules
/** Every rule the guard enforces. */
export const GUARD_RULES = ["drop-table", "drop-column", "drop-fk", "protected"] as const;

/** A guard rule id. */
export type GuardRule = typeof GUARD_RULES[number];

/** One statement the Additive Rule needs a human for. */
export interface GuardFinding {
	rule: GuardRule;
	/** 1-based line of the statement's first token. */
	line: number;
	/** The matched text, whitespace collapsed and cut to 100 characters. Schema SQL holds no secret. */
	statement: string;
	reason: string;
}

/** A parsed approval line. */
export interface Approval {
	decision: number;
	by: string;
	on: string;
	line: number;
}

/** The tables whose columns and foreign keys never change without a human (the Additive Rule). */
export const PROTECTED_TABLES = [
	"finance.escrows",
	"finance.wallets",
	"projects.project_stages",
] as const;

const APPROVAL =
	/^--\s*additive-rule-approved:\s*Decision\s*#(\d+)\s+by\s+(\S(?:.*\S)?)\s+on\s+(\d{4}-\d{2}-\d{2})\s*$/i;
const APPROVAL_PREFIX = /^--\s*additive-rule-approved\b/i;

/**
 * The SQL with every comment blanked to spaces (newlines kept, so offsets and line numbers hold).
 * Quoted literals and identifiers are kept as they are: a `--` inside one is not a comment.
 */
export function stripComments(sql: string): string {
	const out = sql.split("");
	let i = 0;
	const blank = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
	};
	while (i < sql.length) {
		const ch = sql[i];
		const next = sql[i + 1];
		if (ch === "'" || ch === '"') {
			let j = i + 1;
			while (j < sql.length) {
				if (sql[j] === ch && sql[j + 1] === ch) j += 2;
				else if (sql[j] === ch) break;
				else j++;
			}
			i = j + 1;
		} else if (ch === "-" && next === "-") {
			let j = i;
			while (j < sql.length && sql[j] !== "\n") j++;
			blank(i, j);
			i = j;
		} else if (ch === "/" && next === "*") {
			let depth = 1;
			let j = i + 2;
			while (j < sql.length && depth > 0) {
				if (sql[j] === "/" && sql[j + 1] === "*") (depth++, j += 2);
				else if (sql[j] === "*" && sql[j + 1] === "/") (depth--, j += 2);
				else j++;
			}
			blank(i, j);
			i = j;
		} else i++;
	}
	return out.join("");
}

/** A table name pattern that matches it bare, schema-qualified or double-quoted. */
function tableName(qualified: string): string {
	const [schema, table] = qualified.split(".");
	return String.raw`(?:"?${schema}"?\s*\.\s*)?"?${table}"?(?![\w$"])`;
}

const ALTER_TABLE = String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?`;
const NOT_A_COLUMN_DROP = String
	.raw`(?!\s|CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|IDENTITY\b|EXPRESSION\b)`;

interface Pattern {
	rule: GuardRule;
	re: RegExp;
	reason: string;
}

const PATTERNS: readonly Pattern[] = [
	{ rule: "drop-table", re: /\bDROP\s+TABLE\b[^;]*/gi, reason: "drops a table" },
	{
		rule: "drop-table",
		re: /\bDROP\s+SCHEMA\b[^;]*/gi,
		reason: "drops a schema and every table in it",
	},
	{
		rule: "drop-table",
		re: new RegExp(String.raw`${ALTER_TABLE}[^;]*?\bRENAME\s+TO\b[^;]*`, "gi"),
		reason: "renames a table (to its readers, the old name is dropped)",
	},
	{
		rule: "drop-column",
		re: new RegExp(
			String.raw`${ALTER_TABLE}[^;]*?\bDROP\s+${NOT_A_COLUMN_DROP}(?:COLUMN\s+)?[^;]*`,
			"gi",
		),
		reason: "drops a column",
	},
	{
		rule: "drop-column",
		re: new RegExp(
			String.raw`${ALTER_TABLE}[^;]*?\bRENAME\s+(?:COLUMN\s+)?(?!\s|TO\b|CONSTRAINT\b)[^;]*`,
			"gi",
		),
		reason: "renames a column (to its readers, the old name is dropped)",
	},
	{
		rule: "drop-fk",
		re: new RegExp(String.raw`${ALTER_TABLE}[^;]*?\bDROP\s+CONSTRAINT\b[^;]*`, "gi"),
		reason: "drops a constraint, which may be a foreign key",
	},
	...PROTECTED_TABLES.map((table): Pattern => ({
		rule: "protected",
		re: new RegExp(
			String.raw`(?:${ALTER_TABLE}|\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?)${tableName(table)}[^;]*`,
			"gi",
		),
		reason: `changes ${table}, a protected table`,
	})),
];

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
	return line;
}

/** Every statement in `sql` the Additive Rule needs a human for, in file order. Pure. */
export function scanDelta(sql: string): GuardFinding[] {
	const code = stripComments(sql);
	const findings: GuardFinding[] = [];
	const seen = new Set<string>();
	for (const { rule, re, reason } of PATTERNS) {
		for (const match of code.matchAll(re)) {
			const index = match.index ?? 0;
			const key = `${rule}@${index}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const statement = match[0].replace(/\s+/g, " ").trim();
			findings.push({
				rule,
				line: lineAt(code, index),
				statement: statement.length > 100 ? `${statement.slice(0, 99)}…` : statement,
				reason,
			});
		}
	}
	return findings.sort((a, b) =>
		a.line - b.line || GUARD_RULES.indexOf(a.rule) - GUARD_RULES.indexOf(b.rule)
	);
}

/**
 * The file's approval lines, and the lines that start like one but do not parse. Read from the raw
 * text: an approval is itself a comment.
 */
export function findApprovals(sql: string): { approvals: Approval[]; malformed: number[] } {
	const approvals: Approval[] = [];
	const malformed: number[] = [];
	sql.split("\n").forEach((raw, index) => {
		const text = raw.trim();
		if (!APPROVAL_PREFIX.test(text)) return;
		const match = text.match(APPROVAL);
		if (!match) malformed.push(index + 1);
		else {approvals.push({
				decision: Number(match[1]),
				by: match[2],
				on: match[3],
				line: index + 1,
			});}
	});
	return { approvals, malformed };
}

/** The decision numbers the index lists (`- **#N** …` lines). */
export function indexedDecisions(readme: string): Set<number> {
	return new Set([...readme.matchAll(/^- \*\*#(\d+)\*\*/gm)].map((match) => Number(match[1])));
}
// #endregion

// #region CLI
/** The decision index, relative to the repo root. */
export const DECISION_INDEX = "documentation/reference/decisions/README.md";

/** What {@link run} needs from the outside world. Tests pass fakes. */
export interface GuardDeps {
	args: readonly string[];
	readText: (path: string) => Promise<string>;
	print: (line: string) => void;
}

const USAGE = [
	"usage: deno task release:guard <delta.sql> [<delta.sql> ...] [--decisions <README.md>]",
	"  refuses DROP TABLE / SCHEMA, a dropped or renamed column or table, DROP CONSTRAINT, and any",
	`  change to ${PROTECTED_TABLES.join(", ")},`,
	"  unless the file carries: -- additive-rule-approved: Decision #NNN by <name> on YYYY-MM-DD",
	"  exit 0 clean or approved · 1 refused · 2 cannot run",
];

/** Runs the guard over every named file and returns the exit code. */
export async function run(deps: GuardDeps): Promise<number> {
	const say = deps.print;
	const files: string[] = [];
	let indexPath = DECISION_INDEX;
	for (let i = 0; i < deps.args.length; i++) {
		const arg = deps.args[i];
		if (arg === "--help" || arg === "-h") {
			USAGE.forEach(say);
			return 0;
		}
		if (arg === "--decisions") {
			const value = deps.args[++i];
			if (!value || value.startsWith("--")) {
				say("release:guard: --decisions needs a value");
				return 2;
			}
			indexPath = value;
		} else if (arg.startsWith("-")) {
			say(`release:guard: unknown argument ${arg}`);
			USAGE.forEach(say);
			return 2;
		} else files.push(arg);
	}
	if (files.length === 0) {
		say("release:guard: name at least one SQL delta");
		USAGE.forEach(say);
		return 2;
	}

	let decisions: Set<number>;
	try {
		decisions = indexedDecisions((await deps.readText(indexPath)).replaceAll("\r", ""));
	} catch (error) {
		say(`release:guard: cannot read the decision index ${indexPath} (${(error as Error).name})`);
		return 2;
	}

	let refused = false;
	for (const file of files) {
		let sql: string;
		try {
			sql = (await deps.readText(file)).replaceAll("\r", "");
		} catch (error) {
			say(`release:guard: cannot read ${file} (${(error as Error).name})`);
			return 2;
		}
		const findings = scanDelta(sql);
		const { approvals, malformed } = findApprovals(sql);
		say(`release:guard · ${file} · ${findings.length} finding(s)`);
		for (const finding of findings) {
			say(
				`  ✗ ${
					finding.rule.padEnd(11)
				} line ${finding.line}  ${finding.reason}: ${finding.statement}`,
			);
		}
		for (const line of malformed) {
			say(
				`  ✗ approval    line ${line}  does not read "-- additive-rule-approved: Decision #NNN by <name> on YYYY-MM-DD"`,
			);
		}
		const unknown = approvals.filter((approval) => !decisions.has(approval.decision));
		for (const approval of unknown) {
			say(
				`  ✗ approval    line ${approval.line}  names Decision #${approval.decision}, which the decision index does not hold`,
			);
		}
		const valid = approvals.filter((approval) => decisions.has(approval.decision));
		if (malformed.length > 0 || unknown.length > 0) {
			refused = true;
			say(`release:guard: ${file} is refused: fix its approval line`);
		} else if (findings.length === 0) {
			say(`release:guard: ${file} is additive`);
		} else if (valid.length > 0) {
			const approval = valid[0];
			say(
				`release:guard: ${file} is approved by Decision #${approval.decision} (${approval.by}, ${approval.on}) ` +
					`for ${findings.length} finding(s)`,
			);
		} else {
			refused = true;
			say(`release:guard: ${file} is refused: ${findings.length} finding(s) and no approval line`);
		}
	}
	return refused ? 1 : 0;
}

if (import.meta.main) {
	Deno.exit(
		await run({
			args: Deno.args,
			readText: (path) => Deno.readTextFile(path),
			print: (line) => console.log(line),
		}),
	);
}
// #endregion
