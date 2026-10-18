/**
 * The clause-level, word-level diff behind `/legal/<slug>?compare=<version>` (Decision #270).
 *
 * Computed on the server, once per request, from two versions of one document:
 *
 *  1. **Clauses are matched by section id**, never by position — an id is the clause's permanent
 *     address (`#fees`), while its number is its position and moves when a clause is added above it.
 *     A clause is `unchanged`, `changed`, `added` (only in the newer version) or `removed` (only in the
 *     older one, placed after the clause that preceded it there).
 *  2. **Inside a changed clause, blocks are aligned** — every paragraph, list item, table row, term,
 *     sub-heading and the plain-English summary is one text unit; identical units anchor the
 *     alignment (longest common subsequence), and the units between two anchors are paired in order.
 *  3. **A paired unit is diffed word by word**, and the result is tidied so a replaced phrase reads
 *     as one deletion followed by one insertion rather than interleaved single words.
 *
 * Pure and dependency-free (type imports and the schema-free text projection only), so the route,
 * the page controller and a unit test share it.
 *
 * @module
 */
import type { ContentNode, DocSection, ListNode } from "@projective/types/content";
import { inlineText, nodeText } from "@projective/types/content/text";

// #region Words
/** One run of a word diff: unchanged, inserted (only in the newer text) or deleted (only in the older). */
export type DiffOp = "equal" | "insert" | "delete";

/** A run of text and what happened to it. */
export interface DiffSpan {
	op: DiffOp;
	text: string;
}

/**
 * Split text into diffable tokens: runs of whitespace, words (letters and digits, keeping an inner
 * apostrophe, point or comma — `don't`, `1,000`, `2.5`), and single punctuation marks.
 */
export function tokenize(text: string): string[] {
	return text.match(/\s+|[\p{L}\p{N}]+(?:['’.,][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu) ?? [];
}

/**
 * Above this many cells (tokens before × tokens after, once the common prefix and suffix are
 * trimmed) the word table is not built, and the passage is reported as one deletion and one
 * insertion. A clause is a few hundred tokens, so this only guards against a pathological input.
 */
const WORD_TABLE_LIMIT = 1_000_000;

/** Merge adjacent runs that share an op, dropping empty ones. */
function merge(spans: readonly DiffSpan[]): DiffSpan[] {
	const out: DiffSpan[] = [];
	for (const span of spans) {
		if (span.text === "") continue;
		const last = out[out.length - 1];
		if (last && last.op === span.op) last.text += span.text;
		else out.push({ ...span });
	}
	return out;
}

/** The longest-common-subsequence edit script of two token lists. */
function lcsScript(a: readonly string[], b: readonly string[]): DiffSpan[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const head: DiffSpan[] = a.slice(0, start).map((text) => ({ op: "equal", text }));
	const tail: DiffSpan[] = a.slice(endA).map((text) => ({ op: "equal", text }));
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	const n = midA.length;
	const m = midB.length;

	let middle: DiffSpan[];
	if (n === 0 || m === 0 || n * m > WORD_TABLE_LIMIT) {
		middle = [
			...midA.map((text): DiffSpan => ({ op: "delete", text })),
			...midB.map((text): DiffSpan => ({ op: "insert", text })),
		];
	} else {
		// table[i][j] = LCS length of midA[i..] and midB[j..], so a forward walk reads the script.
		const width = m + 1;
		const table = new Uint32Array((n + 1) * width);
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				table[i * width + j] = midA[i] === midB[j]
					? table[(i + 1) * width + j + 1] + 1
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
			}
		}
		middle = [];
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (midA[i] === midB[j]) {
				middle.push({ op: "equal", text: midA[i] });
				i++;
				j++;
			} else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
				middle.push({ op: "delete", text: midA[i++] });
			} else {
				middle.push({ op: "insert", text: midB[j++] });
			}
		}
		while (i < n) middle.push({ op: "delete", text: midA[i++] });
		while (j < m) middle.push({ op: "insert", text: midB[j++] });
	}
	return [...head, ...middle, ...tail];
}

/**
 * Tidy an edit script for reading: an unchanged run of whitespace alone between two changes joins
 * them (so "pay the client" → "refund the payer" reads as one replaced phrase), and inside every
 * stretch of changes the deleted text comes first, then the inserted text.
 */
function tidy(script: readonly DiffSpan[]): DiffSpan[] {
	const merged = merge(script);
	const absorbed: DiffSpan[] = [];
	merged.forEach((span, i) => {
		const between = span.op === "equal" && /^\s+$/.test(span.text) && i > 0 &&
			i < merged.length - 1 && merged[i - 1].op !== "equal" && merged[i + 1].op !== "equal";
		if (between) {
			absorbed.push({ op: "delete", text: span.text }, { op: "insert", text: span.text });
		} else absorbed.push(span);
	});
	const out: DiffSpan[] = [];
	let deleted = "";
	let inserted = "";
	const flush = () => {
		out.push({ op: "delete", text: deleted }, { op: "insert", text: inserted });
		deleted = "";
		inserted = "";
	};
	for (const span of absorbed) {
		if (span.op === "delete") deleted += span.text;
		else if (span.op === "insert") inserted += span.text;
		else {
			flush();
			out.push(span);
		}
	}
	flush();
	return merge(out);
}

/**
 * The word-level diff of two passages: runs that, read in order, spell `before` when the inserted
 * ones are skipped and `after` when the deleted ones are.
 */
export function diffWords(before: string, after: string): DiffSpan[] {
	if (before === after) return before === "" ? [] : [{ op: "equal", text: before }];
	return tidy(lcsScript(tokenize(before), tokenize(after)));
}

/** The passage a diff spells on one side (`before` drops insertions, `after` drops deletions). */
export function spell(spans: readonly DiffSpan[], side: "before" | "after"): string {
	const skip: DiffOp = side === "before" ? "insert" : "delete";
	return spans.filter((span) => span.op !== skip).map((span) => span.text).join("");
}
// #endregion

// #region Clause units
/** What a text unit of a clause is, so the compare view can render it in the right shape. */
export type ClauseUnitKind =
	| "summary"
	| "subheading"
	| "paragraph"
	| "item"
	| "quote"
	| "code"
	| "figure"
	| "note"
	| "row"
	| "term";

/** One diffable text unit of a clause. */
export interface ClauseUnit {
	kind: ClauseUnitKind;
	text: string;
	/** A list item's nesting depth (0 for a top-level item, and for every other kind). */
	depth: number;
}

/** A list's items as units, nested items one level deeper. */
function listUnits(list: ListNode, depth: number): ClauseUnit[] {
	return list.items.flatMap((item): ClauseUnit[] => {
		if (typeof item === "string") return [{ kind: "item", text: item, depth }];
		return [
			{ kind: "item", text: inlineText(item.content), depth },
			...(item.list ? listUnits(item.list, depth + 1) : []),
		];
	});
}

/** One body node as units. */
function nodeUnits(node: ContentNode): ClauseUnit[] {
	switch (node.type) {
		case "p":
			return [{ kind: "paragraph", text: inlineText(node.content), depth: 0 }];
		case "h3":
			return [{ kind: "subheading", text: node.text, depth: 0 }];
		case "list":
			return listUnits(node, 0);
		case "quote":
			return [{ kind: "quote", text: nodeText(node), depth: 0 }];
		case "code":
			return [{ kind: "code", text: node.text, depth: 0 }];
		case "image":
			return [{ kind: "figure", text: nodeText(node), depth: 0 }];
		case "callout": {
			const title = node.title ? `${node.title}: ` : "";
			return [{ kind: "note", text: `${title}${nodeText(node).replace(/\n+/g, " ")}`, depth: 0 }];
		}
		case "table":
			return [
				...(node.caption ? [{ kind: "row" as const, text: node.caption, depth: 0 }] : []),
				...[node.head, ...node.rows].map((row): ClauseUnit => ({
					kind: "row",
					text: row.map(inlineText).join(" · "),
					depth: 0,
				})),
			];
		case "dl":
			return node.items.map((item): ClauseUnit => ({
				kind: "term",
				text: `${item.term} — ${inlineText(item.definition)}`,
				depth: 0,
			}));
	}
}

/** A clause (one section) as its ordered text units: the plain-English summary first, then the body. */
export function clauseUnits(section: DocSection): ClauseUnit[] {
	return [
		...(section.tldr
			? [{ kind: "summary" as const, text: inlineText(section.tldr), depth: 0 }]
			: []),
		...section.body.flatMap(nodeUnits),
	];
}
// #endregion

// #region Clause diff
/** What happened to one unit between the versions. */
export type BlockStatus = "equal" | "changed" | "added" | "removed";

/** One unit of a compared clause and its word diff. */
export interface BlockDiff {
	kind: ClauseUnitKind;
	depth: number;
	status: BlockStatus;
	spans: DiffSpan[];
}

/** What happened to one clause between the versions. */
export type ClauseStatus = "unchanged" | "changed" | "added" | "removed";

/** One clause of a compared document. */
export interface ClauseDiff {
	/** The section id — the clause's anchor in the version it is shown from. */
	id: string;
	status: ClauseStatus;
	/** The heading as shown: the newer version's (the older one's for a removed clause). */
	heading: string;
	/** The heading's own word diff (all `equal` when it did not change). */
	headingSpans: DiffSpan[];
	/** The clause number in the older version (`3`), when it was there. */
	numberBefore?: string;
	/** The clause number in the newer version, when it is there. */
	numberAfter?: string;
	/** The section as shown (newer version; older for a removed clause) — rendered as is when unchanged. */
	section: DocSection;
	/** The aligned units. */
	blocks: BlockDiff[];
}

/** How many clauses fell into each status. */
export type ClauseCounts = Record<ClauseStatus, number>;

/** A whole compared document. */
export interface DocumentDiff {
	/** The older version label. */
	from: string;
	/** The newer version label. */
	to: string;
	clauses: ClauseDiff[];
	counts: ClauseCounts;
}

/** The units only one side has, as whole-unit additions or removals. */
function whole(units: readonly ClauseUnit[], status: "added" | "removed"): BlockDiff[] {
	const op: DiffOp = status === "added" ? "insert" : "delete";
	return units.map((u) => ({
		kind: u.kind,
		depth: u.depth,
		status,
		spans: [{ op, text: u.text }],
	}));
}

/** Align two unit lists: identical units anchor, the gaps between anchors pair up in order. */
export function diffUnits(
	before: readonly ClauseUnit[],
	after: readonly ClauseUnit[],
): BlockDiff[] {
	const same = (x: ClauseUnit, y: ClauseUnit) => x.kind === y.kind && x.text === y.text;
	const n = before.length;
	const m = after.length;
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] = same(before[i], after[j])
				? table[(i + 1) * width + j + 1] + 1
				: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}
	const out: BlockDiff[] = [];
	let gapBefore: ClauseUnit[] = [];
	let gapAfter: ClauseUnit[] = [];
	const closeGap = () => {
		const pairs = Math.min(gapBefore.length, gapAfter.length);
		for (let k = 0; k < pairs; k++) {
			const b = gapBefore[k];
			const a = gapAfter[k];
			if (b.kind === a.kind) {
				out.push({
					kind: a.kind,
					depth: a.depth,
					status: "changed",
					spans: diffWords(b.text, a.text),
				});
			} else {
				out.push(...whole([b], "removed"), ...whole([a], "added"));
			}
		}
		out.push(...whole(gapBefore.slice(pairs), "removed"), ...whole(gapAfter.slice(pairs), "added"));
		gapBefore = [];
		gapAfter = [];
	};
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && same(before[i], after[j])) {
			closeGap();
			out.push({
				kind: after[j].kind,
				depth: after[j].depth,
				status: "equal",
				spans: [{ op: "equal", text: after[j].text }],
			});
			i++;
			j++;
		} else if (j >= m || (i < n && table[(i + 1) * width + j] >= table[i * width + j + 1])) {
			gapBefore.push(before[i++]);
		} else {
			gapAfter.push(after[j++]);
		}
	}
	closeGap();
	return out;
}

/** The two versions {@link diffDocuments} compares — any document shape with sections. */
export interface ComparableDoc {
	version: string;
	sections: readonly DocSection[];
}

/**
 * Compare two versions of a document clause by clause (module header). `before` is the older
 * version, `after` the newer; the clauses come out in the newer version's order, each removed
 * clause placed after the clause that preceded it in the older one.
 */
export function diffDocuments(before: ComparableDoc, after: ComparableDoc): DocumentDiff {
	const beforeIndex = new Map(before.sections.map((s, i) => [s.id, i]));
	const afterIds = new Set(after.sections.map((s) => s.id));

	const kept: ClauseDiff[] = after.sections.map((section, i): ClauseDiff => {
		const at = beforeIndex.get(section.id);
		const numberAfter = String(i + 1);
		if (at === undefined) {
			return {
				id: section.id,
				status: "added",
				heading: section.heading,
				headingSpans: [{ op: "insert", text: section.heading }],
				numberAfter,
				section,
				blocks: whole(clauseUnits(section), "added"),
			};
		}
		const old = before.sections[at];
		const blocks = diffUnits(clauseUnits(old), clauseUnits(section));
		const headingSpans = diffWords(old.heading, section.heading);
		const unchanged = old.heading === section.heading && blocks.every((b) => b.status === "equal");
		return {
			id: section.id,
			status: unchanged ? "unchanged" : "changed",
			heading: section.heading,
			headingSpans,
			numberBefore: String(at + 1),
			numberAfter,
			section,
			blocks,
		};
	});

	// Removed clauses, each after the nearest clause that preceded it in the older version and survives.
	const clauses = [...kept];
	before.sections.forEach((section, at) => {
		if (afterIds.has(section.id)) return;
		const removed: ClauseDiff = {
			id: section.id,
			status: "removed",
			heading: section.heading,
			headingSpans: [{ op: "delete", text: section.heading }],
			numberBefore: String(at + 1),
			section,
			blocks: whole(clauseUnits(section), "removed"),
		};
		let anchor = -1;
		for (let k = at - 1; k >= 0; k--) {
			const id = before.sections[k].id;
			const pos = clauses.findIndex((c) => c.id === id);
			if (pos !== -1) {
				anchor = pos;
				break;
			}
		}
		// After the anchor and after any removed clauses already placed behind it.
		let insertAt = anchor + 1;
		while (insertAt < clauses.length && clauses[insertAt].status === "removed") insertAt++;
		clauses.splice(insertAt, 0, removed);
	});

	const counts: ClauseCounts = { unchanged: 0, changed: 0, added: 0, removed: 0 };
	for (const clause of clauses) counts[clause.status]++;
	return { from: before.version, to: after.version, clauses, counts };
}
// #endregion

// #region Grouping
/** A run of clauses as the compare view renders them: changed ones alone, unchanged ones folded. */
export type ClauseRun =
	| { kind: "clause"; clause: ClauseDiff }
	| { kind: "unchanged"; clauses: ClauseDiff[] };

/** Fold every stretch of consecutive unchanged clauses into one run ("Show 3 unchanged clauses"). */
export function clauseRuns(clauses: readonly ClauseDiff[]): ClauseRun[] {
	const runs: ClauseRun[] = [];
	for (const clause of clauses) {
		const last = runs[runs.length - 1];
		if (clause.status !== "unchanged") runs.push({ kind: "clause", clause });
		else if (last?.kind === "unchanged") last.clauses.push(clause);
		else runs.push({ kind: "unchanged", clauses: [clause] });
	}
	return runs;
}
// #endregion
