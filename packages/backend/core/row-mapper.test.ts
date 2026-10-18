import { assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import {
	defineRowMapper,
	parseRow,
	recordsFromRows,
	RowMapperError,
	rowsFromRecords,
} from "./row-mapper.ts";

/** A two-column table and its camelCase record, the smallest shape that exercises both directions. */
const Row = z.object({ slug: z.string().min(1), page_title: z.string() });
type Row = z.infer<typeof Row>;
interface Page {
	slug: string;
	title: string;
}

const pages = defineRowMapper<Row, Page>({
	table: "editorial.pages",
	key: ["slug"],
	row: Row,
	toRow: (p) => ({ slug: p.slug, page_title: p.title }),
	fromRow: (r) => ({ slug: r.slug, title: r.page_title }),
});

Deno.test("a mapper splits its qualified name and defaults its casts", () => {
	assertEquals(pages.schema, "editorial");
	assertEquals(pages.name, "pages");
	assertEquals(pages.casts, {});
});

Deno.test("a declaration without a schema or a key is refused when it loads", () => {
	assertThrows(
		() => defineRowMapper({ ...pages, table: "pages" as `${string}.${string}` }),
		TypeError,
		"schema-qualified",
	);
	assertThrows(() => defineRowMapper({ ...pages, key: [] }), TypeError, "natural key");
});

Deno.test("authored records round-trip through the row schema unchanged", () => {
	const authored: Page[] = [{ slug: "a", title: "A" }, { slug: "b", title: "B" }];
	const rows = rowsFromRecords(pages, authored);
	assertEquals(rows, [{ slug: "a", page_title: "A" }, { slug: "b", page_title: "B" }]);
	assertEquals(recordsFromRows(pages, rows), authored);
});

Deno.test("a row that fails its schema names the table, the position and the field", () => {
	const err = assertThrows(
		() => recordsFromRows(pages, [{ slug: "a", page_title: "A" }, { slug: "", page_title: "B" }]),
		RowMapperError,
	);
	assertEquals(err.table, "editorial.pages");
	assertEquals(err.index, 1);
	assertEquals(err.issues.startsWith("slug:"), true);
	assertThrows(() => parseRow(pages, { slug: "x" }), RowMapperError, "page_title");
});
