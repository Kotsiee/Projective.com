import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import type { SupabaseClient } from "supabaseClient";
import {
	defineEditorialSurface,
	defineEditorialTable,
	EDITORIAL_SURFACES,
	editorialContent,
	readEditorialTable,
} from "./editorial-source.ts";
import { EDITORIAL_SEEDS, EDITORIAL_SOURCES } from "./content/mod.ts";

/**
 * The editorial reader's two roads. The property worth defending: the fixture road and a live read
 * of the seeded table answer the SAME records, because both run the same row parse and `fromRow`.
 */

const Row = z.object({ slug: z.string(), title: z.string(), body: z.array(z.string()) });
type Row = z.infer<typeof Row>;
interface Entry {
	slug: string;
	title: string;
	paragraphs: string[];
}

const entries = defineEditorialTable<Row, Entry>({
	table: "editorial.entries",
	key: ["slug"],
	row: Row,
	toRow: (e) => ({ slug: e.slug, title: e.title, body: e.paragraphs }),
	fromRow: (r) => ({ slug: r.slug, title: r.title, paragraphs: r.body }),
});

const authored: Entry[] = [{ slug: "funding", title: "How funding works", paragraphs: ["One."] }];
const content = editorialContent(entries, authored);

/** A client whose `.schema(s).from(t).select("*")` answers `answer`, recording what it was asked. */
function stubClient(
	answer: { data: unknown[] | null; error: { code?: string; message: string } | null },
) {
	const asked: string[] = [];
	const client = {
		schema: (s: string) => ({
			from: (t: string) => ({
				select: (cols: string) => {
					asked.push(`${s}.${t}:${cols}`);
					return Promise.resolve(answer);
				},
			}),
		}),
	} as unknown as SupabaseClient;
	return { client, asked };
}

Deno.test("fixture road: authored records come back through the row parse and mapping", async () => {
	const result = await readEditorialTable(content, { source: "fixture" });
	assert(result.ok);
	assertEquals(result.data, { records: authored, source: "fixture" });
});

Deno.test("live road: the seeded rows map to the same records the fixture road serves", async () => {
	const seeded = [{ slug: "funding", title: "How funding works", body: ["One."] }];
	const { client, asked } = stubClient({ data: seeded, error: null });
	const live = await readEditorialTable(content, { source: "live", client });
	const fixture = await readEditorialTable(content, { source: "fixture" });
	assertEquals(asked, ["editorial.entries:*"]);
	assertEquals(live.data?.records, fixture.data?.records);
	assertEquals(live.data?.source, "live");
});

Deno.test("live road: an unexposed schema is a 503 carrying the PostgREST code", async () => {
	const { client } = stubClient({
		data: null,
		error: { code: "PGRST106", message: "not exposed" },
	});
	const result = await readEditorialTable(content, { source: "live", client });
	assertEquals(result.status, 503);
	assertEquals(result.details, { table: "editorial.entries", code: "PGRST106" });
});

Deno.test("a drifted row is a 500 naming the table and row, not a crash", async () => {
	const { client } = stubClient({ data: [{ slug: "x", title: 1, body: [] }], error: null });
	const result = await readEditorialTable(content, { source: "live", client });
	assertEquals(result.status, 500);
	assertEquals(result.details?.table, "editorial.entries");
	assertEquals(result.details?.row, 0);
});

Deno.test("an editorial table outside the editorial schema is refused", () => {
	assertThrows(
		() =>
			defineEditorialTable({
				...entries,
				table: "community.entries" as `editorial.${string}`,
			}),
		TypeError,
		"editorial schema",
	);
});

Deno.test("a surface cannot list one table twice", () => {
	assertThrows(() => defineEditorialSurface("help", [content, content]), TypeError, "twice");
});

Deno.test("every surface has exactly one content source and one category-5 seed file", () => {
	assertEquals(Object.keys(EDITORIAL_SOURCES).sort(), [...EDITORIAL_SURFACES].sort());
	assertEquals(EDITORIAL_SEEDS.map((s) => s.source.surface).sort(), [...EDITORIAL_SURFACES].sort());
	for (const seed of EDITORIAL_SEEDS) {
		assert(/^00005\d{3}_seed_editorial_[a-z]+\.sql$/.test(seed.file), seed.file);
		assertEquals(seed.source, EDITORIAL_SOURCES[seed.source.surface]);
	}
	assertEquals(new Set(EDITORIAL_SEEDS.map((s) => s.file)).size, EDITORIAL_SEEDS.length);
});
