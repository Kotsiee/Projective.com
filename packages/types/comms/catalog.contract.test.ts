/**
 * Every key an emitter sends must be in the catalog seed. `comms.fn_notify` auto-registers an unknown
 * key as category `system`, which silently routes a money event around its mandatory, quiet-hours
 * piercing policy — so the gap has to fail here, on a laptop with no database. Reads the migrations
 * (the `pii.contract.test.ts` technique) and the `p_type` of every backend `rpc("fn_notify")` call.
 */
import { assert, assertEquals } from "@std/assert";
import { KNOWN_NOTIFICATION_TYPES, NOTIFICATION_TYPE_ALIASES } from "./catalog.ts";

const REPO = new URL("../../../", import.meta.url);
const MIGRATIONS = new URL("supabase/migrations/", REPO);
const BACKEND = new URL("packages/backend/services/", REPO);
const read = (url: URL) => Deno.readTextFileSync(url).replace(/\r\n/g, "\n");

/** `p_kind` / `v_kind` are always one of these (`p_kind NOT IN ('team', 'business')`, 00001020). */
const WORKSPACE_KINDS = ["team", "business"];
/** Pass-through arguments: the wrapper forwards a key some other emitter chose. */
const PASS_THROUGH = new Set(["p_type", "v_row.type"]);

// #region Parsing
/** The text of a call's argument list, starting just after `(`, string- and paren-aware. */
function argList(sql: string, open: number): string[] {
	const args: string[] = [];
	let depth = 0, start = open, i = open;
	for (; i < sql.length; i++) {
		const c = sql[i];
		if (c === "'") {
			i = sql.indexOf("'", i + 1);
			while (sql[i + 1] === "'") i = sql.indexOf("'", i + 2);
		} else if (c === "(") depth++;
		else if (c === ")" && depth-- === 0) break;
		else if (c === "," && depth === 0) {
			args.push(sql.slice(start, i).trim());
			start = i + 1;
		}
	}
	args.push(sql.slice(start, i).trim());
	return args;
}

/** The keys a `p_type` argument expression can evaluate to. */
function keysOf(expr: string, file: string, sql: string): string[] {
	if (PASS_THROUGH.has(expr)) return [];
	if (expr.includes("||")) {
		const suffix = expr.match(/'(\.[a-z_]+)'/)?.[1];
		assert(suffix, `${file}: unrecognised concatenated key ${expr}`);
		return WORKSPACE_KINDS.map((k) => k + suffix);
	}
	if (/^CASE\b/i.test(expr)) {
		return [...expr.matchAll(/(?:THEN|ELSE)\s+'([^']+)'/gi)].map((m) => m[1]);
	}
	const literal = expr.match(/^'([^']+)'$/);
	if (literal) return [literal[1]];
	assert(/^[a-z_]+$/.test(expr), `${file}: unrecognised key expression ${expr}`);
	const assigned = [...sql.matchAll(new RegExp(`\\b${expr}\\s*:=\\s*'([^']+)'`, "g"))].map((m) =>
		m[1]
	);
	assert(assigned.length > 0, `${file}: no literal assignment found for ${expr}`);
	return assigned;
}

function emittedBySql(): Map<string, string> {
	const out = new Map<string, string>();
	for (const entry of Deno.readDirSync(MIGRATIONS)) {
		if (!entry.name.endsWith(".sql")) continue;
		// Comments carry example calls; drop them before scanning.
		const sql = read(new URL(entry.name, MIGRATIONS)).replace(/--[^\n]*/g, "");
		for (const m of sql.matchAll(/(FUNCTION\s+)?comms\.fn_notify(?:_many)?\s*\(/g)) {
			if (m[1]) continue; // a definition or a GRANT, not a call
			const key = argList(sql, m.index! + m[0].length)[1];
			for (const k of keysOf(key, entry.name, sql)) out.set(k, entry.name);
		}
	}
	return out;
}

function emittedByBackend(dir = BACKEND, out = new Map<string, string>()): Map<string, string> {
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isDirectory) emittedByBackend(new URL(`${entry.name}/`, dir), out);
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			for (
				const m of read(new URL(entry.name, dir)).matchAll(
					/rpc\("fn_notify(?:_many)?",\s*\{[^}]*?\bp_type:\s*"([^"]+)"/g,
				)
			) {
				out.set(m[1], entry.name);
			}
		}
	}
	return out;
}

/** `key → aliases` from the seed rows. */
function seededCatalog(): Map<string, string[]> {
	const sql = read(new URL("00005010_seed_notification_catalog.sql", MIGRATIONS));
	return new Map(
		[...sql.matchAll(/^\('([a-z0-9_.]+)',\s*'\{([^}]*)\}'/gm)].map((m) => [
			m[1],
			m[2] ? m[2].split(",").map((a) => a.trim()) : [],
		]),
	);
}
// #endregion

Deno.test("every key emitted by a migration or a backend service is catalogued", () => {
	const catalog = seededCatalog();
	const known = new Set([...catalog.keys(), ...[...catalog.values()].flat()]);
	const emitted = new Map([...emittedBySql(), ...emittedByBackend()]);
	assert(emitted.size > 20, "the emitter scan found almost nothing — the parser is broken");
	const missing = [...emitted].filter(([k]) => !known.has(k)).map(([k, f]) => `${k} (${f})`);
	assertEquals(missing, [], "emitted but not in 00005010_seed_notification_catalog.sql");
});

Deno.test("the TypeScript catalog mirrors the seed exactly", () => {
	const catalog = seededCatalog();
	assertEquals([...KNOWN_NOTIFICATION_TYPES].sort(), [...catalog.keys()].sort());
	const aliases = Object.fromEntries(
		[...catalog].flatMap(([key, as]) => as.map((a) => [a, key] as const)),
	);
	assertEquals({ ...NOTIFICATION_TYPE_ALIASES }, aliases);
});
