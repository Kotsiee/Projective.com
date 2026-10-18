import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import type { SupabaseClient } from "supabaseClient";
import { communityRpc, defineCommunityTable, readCommunityTable } from "./community-source.ts";

/**
 * The community reader's two roads and its definer-door seam. Fixture records go through the same row
 * parse as live rows, and the fixture filter stands in for the live query's WHERE clause.
 */

const Row = z.object({ id: z.string(), title: z.string(), status: z.enum(["Backlog", "Ready"]) });
type Row = z.infer<typeof Row>;
interface Idea {
	id: string;
	title: string;
	public: boolean;
}

const ideas = defineCommunityTable<Row, Idea>({
	table: "community.ideas",
	key: ["id"],
	row: Row,
	toRow: (i) => ({ id: i.id, title: i.title, status: i.public ? "Ready" : "Backlog" }),
	fromRow: (r) => ({ id: r.id, title: r.title, public: r.status === "Ready" }),
});

const fixtures: Idea[] = [
	{ id: "1", title: "Dark mode exports", public: true },
	{ id: "2", title: "Under review", public: false },
];

/** A client stub recording the schema and table each call reached. */
function stubClient(rows: unknown[]) {
	const asked: string[] = [];
	const client = {
		schema: (s: string) => ({
			from: (t: string) => ({
				select: () => {
					asked.push(`${s}.${t}`);
					return Promise.resolve({ data: rows, error: null });
				},
			}),
			rpc: (fn: string, args: Record<string, unknown>) => {
				asked.push(`${s}.${fn}(${JSON.stringify(args)})`);
				return Promise.resolve({ data: { ok: true }, error: null });
			},
		}),
	} as unknown as SupabaseClient;
	return { client, asked };
}

Deno.test("fixture road: records pass the row parse and the filter applies", async () => {
	const result = await readCommunityTable(ideas, {
		source: "fixture",
		client: () => {
			throw new Error("the fixture road never builds a client");
		},
		fixtures,
		filter: (idea) => idea.public,
	});
	assert(result.ok);
	assertEquals(result.data, { records: [fixtures[0]], source: "fixture" });
});

Deno.test("live road: the default query reads the whole community table", async () => {
	const { client, asked } = stubClient([{ id: "1", title: "Dark mode exports", status: "Ready" }]);
	const result = await readCommunityTable(ideas, {
		source: "live",
		client: () => client,
		fixtures,
	});
	assertEquals(asked, ["community.ideas"]);
	assertEquals(result.data?.records, [fixtures[0]]);
});

Deno.test("a fixture the table would refuse fails as a 500, not a served record", async () => {
	const broken = defineCommunityTable<Row, Idea>({
		...ideas,
		table: "community.ideas",
		toRow: (i) => ({ id: i.id, title: i.title, status: "Shipped" as "Ready" }),
	});
	const result = await readCommunityTable(broken, {
		source: "fixture",
		client: () => stubClient([]).client,
		fixtures,
	});
	assertEquals(result.status, 500);
});

Deno.test("definer doors are called on the community schema", async () => {
	const { client, asked } = stubClient([]);
	const { data } = await communityRpc(client, "vote_idea", { p_idea: "1" });
	assertEquals(data, { ok: true });
	assertEquals(asked, ['community.vote_idea({"p_idea":"1"})']);
});

Deno.test("a community table outside the community schema is refused", () => {
	assertThrows(
		() => defineCommunityTable({ ...ideas, table: "editorial.ideas" as `community.${string}` }),
		TypeError,
		"community schema",
	);
});
