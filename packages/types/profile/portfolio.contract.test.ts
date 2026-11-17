/**
 * The portfolio write path (Decision #439): the Zod the owner's editor and the route check against,
 * and — over FILE CONTENT, so it fails with no database the moment one side is edited without the
 * other — the SQL door's limits, the archive column, the read's archive filter and the grants.
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
	ArchivePortfolioPieceSchema,
	PORTFOLIO_LIMITS,
	SavePortfolioPieceSchema,
} from "./edit.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\s+/g, " ");

const TABLES_SQL = "supabase/migrations/00000011_tables_org.sql";
const FUNCTIONS_SQL = "supabase/migrations/00001040_functions_org_profiles.sql";
const GRANTS_SQL = "supabase/migrations/00002510_permissions_function_grants.sql";

const ID = "6f1d2b8e-4a1c-4c55-9d1e-2f6b0e3a7c10";
const ASSET = "0b7c1e2d-3f4a-4b5c-8d6e-7f8091a2b3c4";

function sqlBody(name: string): string {
	const sql = read(FUNCTIONS_SQL);
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is defined in ${FUNCTIONS_SQL}`);
	const end = sql.indexOf("$$;", sql.indexOf("AS $$", start));
	return sql.slice(start, end);
}

// #region Zod

Deno.test("a new piece needs a cover; an edit may keep its own", () => {
	const fresh = SavePortfolioPieceSchema.safeParse({ title: "Night mode", isPublic: true });
	assertFalse(fresh.success);
	assertEquals(fresh.error?.issues[0]?.path, ["cover"]);

	assert(SavePortfolioPieceSchema.safeParse({
		title: "Night mode",
		isPublic: true,
		cover: { sourceAssetId: ASSET },
	}).success);
	assert(SavePortfolioPieceSchema.safeParse({ id: ID, title: "Night mode", isPublic: false }).success);
});

Deno.test("the piece is strict, trimmed and held to its limits", () => {
	const base = { id: ID, isPublic: true };
	assertFalse(SavePortfolioPieceSchema.safeParse({ ...base, title: "x", sortOrder: 0 }).success);
	assertFalse(SavePortfolioPieceSchema.safeParse({ ...base, title: "   " }).success);
	assertFalse(
		SavePortfolioPieceSchema.safeParse({ ...base, title: "x".repeat(PORTFOLIO_LIMITS.title + 1) }).success,
	);
	assertFalse(
		SavePortfolioPieceSchema.safeParse({
			...base,
			title: "x",
			category: "c".repeat(PORTFOLIO_LIMITS.category + 1),
		}).success,
	);
	assertFalse(
		SavePortfolioPieceSchema.safeParse({
			...base,
			title: "x",
			description: "d".repeat(PORTFOLIO_LIMITS.description + 1),
		}).success,
	);
	const parsed = SavePortfolioPieceSchema.parse({ ...base, title: "  Night mode  ", client: "", category: null });
	assertEquals(parsed.title, "Night mode");
	assertEquals(parsed.description, "");
	assertEquals(parsed.client, "");
	assertEquals(parsed.category, null);
});

Deno.test("an archive names one piece and nothing else", () => {
	assert(ArchivePortfolioPieceSchema.safeParse({ id: ID }).success);
	assertFalse(ArchivePortfolioPieceSchema.safeParse({ id: "not-a-uuid" }).success);
	assertFalse(ArchivePortfolioPieceSchema.safeParse({ id: ID, hard: true }).success);
});

// #endregion

// #region SQL agreement

Deno.test("the door holds the same limits as the Zod", () => {
	const door = sqlBody("org.save_portfolio_piece");
	assertStringIncludes(door, `NOT BETWEEN 1 AND ${PORTFOLIO_LIMITS.title}`);
	assertStringIncludes(door, `COALESCE(v_client, '')) > ${PORTFOLIO_LIMITS.client}`);
	assertStringIncludes(door, `COALESCE(v_category, '')) > ${PORTFOLIO_LIMITS.category}`);
	assertStringIncludes(door, `char_length(v_description) > ${PORTFOLIO_LIMITS.description}`);
	assertStringIncludes(door, `>= ${PORTFOLIO_LIMITS.pieces} THEN`);
	assertStringIncludes(door, "'cover: choose a cover picture'");
	assertStringIncludes(door, "SECURITY DEFINER SET search_path = ''");
});

Deno.test("an archived piece leaves the read and is never deleted", () => {
	assertStringIncludes(read(TABLES_SQL), "archived_at timestamp with time zone,");
	const readFn = sqlBody("org.get_profile_portfolio");
	assertStringIncludes(readFn, "AND pf.archived_at IS NULL");
	assertStringIncludes(readFn, "'is_public', pf.is_public");
	const archive = sqlBody("org.archive_portfolio_piece");
	assertStringIncludes(archive, "SET archived_at = now()");
	assertFalse(/DELETE FROM org\.portfolios/.test(archive));
	assertFalse(/DELETE FROM org\.portfolios/.test(sqlBody("org.save_portfolio_piece")));
});

Deno.test("both doors are granted by name to signed-in callers only", () => {
	const grants = read(GRANTS_SQL);
	for (const sig of ["org.save_portfolio_piece (text, uuid, jsonb)", "org.archive_portfolio_piece (text, uuid, uuid)"]) {
		assertStringIncludes(grants, `REVOKE ALL ON FUNCTION ${sig} FROM public, anon;`);
		assertStringIncludes(grants, `GRANT EXECUTE ON FUNCTION ${sig} TO authenticated, service_role;`);
	}
});

// #endregion
