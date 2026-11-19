/**
 * The cross-check between the semantic blend's code dials and their business record (Decision #339,
 * ruling N4). The dials live in two places: the constants in `./semantic.ts`, which rank, and the
 * "Semantic blend" row of `documentation/business/finance-model.md` §16.7, which says what the
 * business agreed to. A type-checker cannot see the second, so a dial edited on one side alone would
 * ship silently.
 *
 * Like `packages/types/slugs/slug.contract.test.ts`, this reads FILE CONTENT rather than asking a
 * service, so it fails on a laptop and in CI the moment one side moves without the other.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
	SEMANTIC_BLEND_WEIGHT,
	SEMANTIC_EXTRA_LIMIT,
	SEMANTIC_EXTRA_MIN_SIMILARITY,
	SEMANTIC_EXTRA_RELATIVE,
} from "./semantic.ts";

const REPO = new URL("../../../../", import.meta.url);
const FINANCE_MODEL = "documentation/business/finance-model.md";

/** The four dials as §16.7's "Semantic blend" row states them. */
interface BlendRow {
	weight: number;
	floor: number;
	relative: number;
	extras: number;
}

/** The finance model as LF text. */
function financeModel(): string {
	return Deno.readTextFileSync(new URL(FINANCE_MODEL, REPO)).replace(/\r\n/g, "\n");
}

/** Pull §16.7's "Semantic blend" row's dials out of `doc`; throws when the section or row moved. */
function readBlendRow(doc: string): BlendRow {
	const start = doc.indexOf("\n### 16.7 ");
	assert(start >= 0, `${FINANCE_MODEL} has no §16.7`);
	const next = doc.indexOf("\n### ", start + 1);
	const section = doc.slice(start, next === -1 ? undefined : next);
	const row = section.split("\n").find((line) => /^\|\s*Semantic blend\s*\|/.test(line));
	assert(row, `§16.7 has no "Semantic blend" row`);
	const m = row.match(
		/Weight ([\d.]+) · floor ([\d.]+) · relative ([\d.]+) · at most (\d+) extra results/,
	);
	assert(
		m,
		`the "Semantic blend" row no longer reads "Weight … · floor … · relative … · at most … extra results": ${row}`,
	);
	return {
		weight: Number(m[1]),
		floor: Number(m[2]),
		relative: Number(m[3]),
		extras: Number(m[4]),
	};
}

/** The code's dials, in the row's shape. */
const CODE: BlendRow = {
	weight: SEMANTIC_BLEND_WEIGHT,
	floor: SEMANTIC_EXTRA_MIN_SIMILARITY,
	relative: SEMANTIC_EXTRA_RELATIVE,
	extras: SEMANTIC_EXTRA_LIMIT,
};

Deno.test("semantic blend — the code's dials equal finance-model §16.7's row", () => {
	assertEquals(CODE, readBlendRow(financeModel()));
});

Deno.test("semantic blend — a dial edited in §16.7 alone breaks the parity", () => {
	const doc = financeModel();
	for (
		const [from, to] of [
			["Weight 0.5 ·", "Weight 0.6 ·"],
			["floor 0.30 ·", "floor 0.25 ·"],
			["relative 0.8 ·", "relative 0.7 ·"],
			["at most 12 extra", "at most 10 extra"],
		]
	) {
		assert(doc.includes(from), `§16.7's row no longer reads "${from}"`);
		assertNotEquals(CODE, readBlendRow(doc.replace(from, to)), `editing "${from}" went unnoticed`);
	}
});
