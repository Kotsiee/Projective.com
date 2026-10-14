/**
 * `catalogue.get_client_pipeline` (00001170) returns columns and literals that `ClientEngagementRowSchema`
 * parses and `laneOf` reads. A renamed column, an engagement kind or an action reason outside the Zod
 * vocabulary would fail every parse at runtime, so it fails here instead, with no database.
 */
import { assert, assertEquals } from "@std/assert";
import { ActionReason, ClientEngagementRowSchema, EngagementKind } from "./clients.ts";

const MIGRATION = new URL(
	"../../../supabase/migrations/00001170_functions_catalogue.sql",
	import.meta.url,
);

function pipelineSql(): string {
	const sql = Deno.readTextFileSync(MIGRATION).replace(/\r\n/g, "\n");
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION catalogue.get_client_pipeline");
	const end = sql.indexOf("\n$$;", start);
	if (start < 0 || end < 0) throw new Error("catalogue.get_client_pipeline not found in 00001170");
	return sql.slice(start, end);
}

Deno.test("the RPC's columns are ClientEngagementRowSchema's keys, in order", () => {
	const table = pipelineSql().match(/RETURNS TABLE \(\n([\s\S]*?)\n\)/);
	assert(table, "RETURNS TABLE clause not found");
	const columns = table[1].split("\n").map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
	assertEquals(columns, Object.keys(ClientEngagementRowSchema.shape));
});

Deno.test("every arm is one EngagementKind, and every kind has an arm", () => {
	const kinds = [...pipelineSql().matchAll(/^\s+SELECT '([a-z_]+)'/gm)].map((m) => m[1]);
	assertEquals([...kinds].sort(), [...EngagementKind.options].sort());
});

Deno.test("every action reason the RPC emits is an ActionReason", () => {
	const reasons = new Set([
		...[...pipelineSql().matchAll(/THEN '([a-z_]+)' END/g)].map((m) => m[1]),
		...[...pipelineSql().matchAll(/THEN ARRAY\['([a-z_]+)'\]/g)].map((m) => m[1]),
	]);
	assert(reasons.size > 0, "no action reasons found");
	for (const reason of reasons) {
		assert(ActionReason.safeParse(reason).success, `unknown reason ${reason}`);
	}
	assertEquals([...reasons].sort(), [...ActionReason.options].sort());
});
