/**
 * The contract between the workspace permission engine's two implementations — the TypeScript SSOT
 * (`common.ts`: `capabilitiesForKind`, `presetCapabilities`, `roleRank`) and its SQL twin in
 * `00001020_functions_org_entities.sql` §6/§9 (`org.fn_kind_capabilities`, `org.fn_preset_capabilities`,
 * `org.fn_preset_rank`, `org.fn_is_reserved_handle`), plus the `org.workspace_capability` enum itself.
 *
 * Every write RPC gates on the SQL twin while every screen renders from the TypeScript, so a list that
 * moves on one side alone makes the console offer an action the database refuses (or hide one it would
 * allow). The two cannot be compared by a type-checker; this test compares the FILE CONTENT (the
 * `hired-teams.contract.test.ts` technique), so it fails with no database.
 */
import { assert, assertEquals } from "@std/assert";
import {
	capabilitiesForKind,
	presetCapabilities,
	roleRank,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceRole,
} from "./common.ts";
import { RESERVED_HANDLES } from "../profile/reserved.ts";

// #region Reading the SQL

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const ENTITIES_SQL = "supabase/migrations/00001020_functions_org_entities.sql";
const ENUMS_SQL = "supabase/migrations/00000004_enums_domains.sql";

/** The body of one `CREATE OR REPLACE FUNCTION <name>(` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

/** Every single-quoted literal in a fragment, in order. */
function literals(fragment: string): string[] {
	return [...fragment.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** The members of `org.workspace_capability`, in declaration order (comments stripped). */
function capabilityEnum(): string[] {
	const sql = read(ENUMS_SQL);
	const start = sql.indexOf("CREATE TYPE org.workspace_capability AS ENUM (");
	assert(
		start >= 0,
		"org.workspace_capability is no longer declared in 00000004_enums_domains.sql",
	);
	const end = sql.indexOf(");", start);
	const block = sql.slice(start, end).split("\n").map((line) => line.replace(/--.*$/, "")).join(
		"\n",
	);
	return literals(block);
}

const entities = read(ENTITIES_SQL);
const kindBody = functionBody(entities, "org.fn_kind_capabilities");
const presetBody = functionBody(entities, "org.fn_preset_capabilities");
const rankBody = functionBody(entities, "org.fn_preset_rank");
const reservedBody = functionBody(entities, "org.fn_is_reserved_handle");

/** The capabilities `org.fn_kind_capabilities` excludes for a kind. */
function excludedFor(kind: string): string[] {
	const match = new RegExp(`WHEN '${kind}' THEN e\\.c NOT IN \\(([^)]*)\\)`).exec(kindBody);
	assert(match, `org.fn_kind_capabilities has no NOT IN branch for '${kind}'`);
	return literals(match[1]);
}

/** The raw capability bundle `org.fn_preset_capabilities` lists for a preset (`owner` = every member). */
function presetArray(role: string, all: readonly string[]): string[] {
	if (role === "owner") {
		assert(
			/WHEN 'owner' THEN enum_range\(NULL::org\.workspace_capability\)/.test(presetBody),
			"the owner preset no longer grants the whole enum",
		);
		return [...all];
	}
	const match = new RegExp(`WHEN '${role}' THEN ARRAY\\[([^\\]]*)\\]`).exec(presetBody);
	assert(match, `org.fn_preset_capabilities has no ARRAY for '${role}'`);
	return literals(match[1]);
}

/** Sort a capability list into enum order — the order every SQL twin returns and the SSOT filters in. */
function inEnumOrder(list: readonly string[], all: readonly string[]): string[] {
	return all.filter((c) => list.includes(c));
}

// #endregion

// #region Tests

Deno.test("org.workspace_capability declares WorkspaceCapability.options, in order", () => {
	assertEquals(capabilityEnum(), [...WorkspaceCapability.options]);
});

Deno.test("org.fn_kind_capabilities filters exactly as capabilitiesForKind does, for both kinds", () => {
	const all = capabilityEnum();
	for (const kind of WorkspaceKind.options) {
		const excluded = excludedFor(kind);
		for (const cap of excluded) {
			assert(all.includes(cap), `'${cap}' excluded for ${kind} is not a capability`);
		}
		assertEquals(
			all.filter((c) => !excluded.includes(c)),
			capabilitiesForKind(kind),
			`kind ${kind}`,
		);
	}
});

Deno.test("org.fn_preset_capabilities carries the SSOT's preset bundles — owner = every capability", () => {
	const all = capabilityEnum();
	const branches = [...presetBody.matchAll(/WHEN '(\w+)' THEN/g)].map((m) => m[1]).sort();
	assertEquals(
		branches,
		[...WorkspaceRole.options].sort(),
		"the preset CASE names a different set of presets",
	);
	for (const role of WorkspaceRole.options) {
		const raw = presetArray(role, all);
		for (const cap of raw) {
			assert(all.includes(cap), `'${cap}' in the ${role} preset is not a capability`);
		}
		// The raw ARRAY is the preset's whole bundle: the union of what each kind renders of it.
		const union = inEnumOrder(
			WorkspaceKind.options.flatMap((kind) => presetCapabilities(role, kind)),
			all,
		);
		assertEquals(inEnumOrder(raw, all), union, `raw ${role} bundle`);
		// And kind-scoped, exactly as the SQL intersects it with fn_kind_capabilities.
		for (const kind of WorkspaceKind.options) {
			const kindCaps = capabilitiesForKind(kind) as string[];
			assertEquals(
				inEnumOrder(raw.filter((c) => kindCaps.includes(c)), all),
				presetCapabilities(role, kind),
				`${role} on a ${kind}`,
			);
		}
	}
});

Deno.test("org.fn_preset_rank ranks the presets exactly as roleRank does", () => {
	const ranks = new Map(
		[...rankBody.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]),
	);
	assertEquals([...ranks.keys()].sort(), [...WorkspaceRole.options].sort());
	for (const role of WorkspaceRole.options) {
		assertEquals(ranks.get(role), roleRank(role), `rank of ${role}`);
	}
	assert(/ELSE 0 END/.test(rankBody), "an unknown preset must rank below every real one");
});

Deno.test("org.fn_is_reserved_handle reserves exactly RESERVED_HANDLES", () => {
	const start = reservedBody.indexOf("ARRAY[");
	assert(start >= 0, "org.fn_is_reserved_handle no longer lists its handles in an ARRAY");
	const list = literals(reservedBody.slice(start, reservedBody.indexOf("]", start)));
	assertEquals(new Set(list), new Set(RESERVED_HANDLES));
	assertEquals(list.length, new Set(list).size, "the SQL list repeats a handle");
});

// #endregion
