/**
 * sql.ts — the small vocabulary every seed emitter writes SQL with.
 *
 * Everything here is pure and synchronous: the emitters are string builders, and a helper that could
 * throw or await would make a seed file's content depend on something other than the world it
 * describes.
 */

// #region Deterministic identity
/**
 * A stable UUID for a natural key.
 *
 * FNV-1a over `${namespace}:${key}`, expanded to 128 bits and stamped with the version-4 nibbles so
 * Postgres accepts it as a `uuid`. It is deliberately NOT a real UUIDv5 — that needs SHA-1 and an
 * async Web Crypto call, and this runs thousands of times to write a file. What matters here is only
 * that it is stable, collision-free across this corpus, and syntactically a UUID.
 */
export function uuidFor(namespace: string, key: string): string {
	const input = `${namespace}:${key}`;
	const words: number[] = [];
	for (let seed = 0; seed < 4; seed++) {
		let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
		for (let i = 0; i < input.length; i++) {
			h ^= input.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		words.push(h >>> 0);
	}
	const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
	const v = `${hex.slice(0, 12)}4${hex.slice(13, 16)}a${hex.slice(17, 32)}`;
	return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${
		v.slice(20, 32)
	}`;
}

/** The 32-symbol alphabet `security.mint_slug` uses (`0 1 i l` dropped as confusable). */
const SLUG_ALPHABET = "23456789abcdefghjkmnopqrstuvwxyz";

/**
 * A deterministic, shape-valid opaque slug (`prj-…`, `stg-…`, `tkt-…`, `svc-…`).
 *
 * The slug guard trigger accepts an explicit slug on INSERT as long as it matches the CHECK, so
 * minting one here gives every seeded project a STABLE address across resets — a bookmark to a seeded
 * project survives `supabase db reset`, which a trigger-minted random slug would not.
 */
export function slugFor(prefix: string, key: string): string {
	const id = uuidFor(`slug-${prefix}`, key).replace(/-/g, "");
	let out = "";
	for (let i = 0; i < 10; i++) {
		out += SLUG_ALPHABET[parseInt(id.slice(i * 2, i * 2 + 2), 16) % SLUG_ALPHABET.length];
	}
	return `${prefix}-${out}`;
}
// #endregion

// #region Literals
/** Escape a value for a single-quoted SQL literal, or emit NULL. */
export function q(value: string | null | undefined): string {
	if (value === null || value === undefined) return "NULL";
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** A uuid literal, or NULL. */
export function id(value: string | null | undefined): string {
	return value ? `'${value}'` : "NULL";
}

/** A Postgres `text[]` literal. */
export function arr(values: readonly string[]): string {
	if (!values.length) return `'{}'::text[]`;
	return `ARRAY[${values.map(q).join(", ")}]::text[]`;
}

/** A typed enum array literal, e.g. `ARRAY['a','b']::org.team_permission[]`. */
export function enumArr(values: readonly string[], type: string): string {
	if (!values.length) return `'{}'::${type}[]`;
	return `ARRAY[${values.map(q).join(", ")}]::${type}[]`;
}

/** A `jsonb` literal from any JSON-serialisable value. */
export function jsonb(value: unknown): string {
	return `${q(JSON.stringify(value))}::jsonb`;
}

/** A number or NULL. */
export function num(value: number | null | undefined): string {
	return value === null || value === undefined ? "NULL" : String(value);
}

/** `now() - interval '<n> days'` (fractional days are allowed: 0.5 = twelve hours). */
export function ago(days: number): string {
	if (days === 0) return "now()";
	const hours = Math.round(days * 24);
	return `now() - interval '${hours} hours'`;
}

/** `now() + interval '<n> days'`. */
export function ahead(days: number): string {
	const hours = Math.round(days * 24);
	return `now() + interval '${hours} hours'`;
}

/**
 * A wall-clock instant in a zone, placed relative to the CURRENT week: `week` weeks from this week's
 * Monday (0 = this week, 1 = next, -1 = last), `day` days after that Monday (0 = Mon … 6 = Sun), at
 * `minute` minutes past local midnight.
 *
 * Resolved by Postgres at seed time, so a seeded "Tuesday 14:00 in London" is Tuesday 14:00 in London
 * whatever day the reset runs — which is what lets a seeded booking land INSIDE the provider's call
 * window rather than at whatever hour `now() + n days` happens to be. Adding whole days to a local
 * `timestamp` (no zone) is wall-clock arithmetic, so a DST change between now and then cannot shift it.
 */
export function localAt(tz: string, week: number, day: number, minute: number): string {
	const days = week * 7 + day;
	return `((date_trunc('week', now() AT TIME ZONE ${q(tz)}) + interval '${days} days' + interval '${minute} minutes') AT TIME ZONE ${
		q(tz)
	})`;
}

/** `HH:MM` → minutes past midnight. */
export function minutesOf(hhmm: string): number {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

/** Split a display name into first/last. */
export function splitName(name: string): { first: string; last: string } {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return { first: parts[0], last: "" };
	return { first: parts[0], last: parts.slice(1).join(" ") };
}
// #endregion

// #region Statement builders
/**
 * One multi-row INSERT with an explicit conflict target.
 *
 * The arbiter is always named. A bare `ON CONFLICT DO NOTHING` asks Postgres to infer one from every
 * unique constraint on the table, and a DEFERRABLE unique constraint (e.g.
 * `uq_listing_media_position`) may not be an arbiter — so a bare form fails on exactly the tables
 * that need it most. `conflict: null` emits no clause for tables with no usable arbiter.
 */
export function insert(
	table: string,
	columns: readonly string[],
	rows: readonly (readonly string[])[],
	conflict: string | null = "(id)",
): string {
	if (!rows.length) return `-- ${table}: nothing to insert.\n`;
	const head = `INSERT INTO ${table} (${columns.join(", ")})\nVALUES\n`;
	const body = rows.map((r) => `  (${r.join(", ")})`).join(",\n");
	const tail = conflict === null ? ";\n" : `\nON CONFLICT ${conflict} DO NOTHING;\n`;
	return head + body + tail;
}

/**
 * A multi-row INSERT that skips rows whose id already exists BEFORE any trigger sees them.
 *
 * `ON CONFLICT DO NOTHING` resolves the duplicate only after BEFORE INSERT triggers have run, so a
 * guard such as `projects.fn_enforce_structure_variation` ("a one-off project has one ticket")
 * counts the existing row plus the duplicate and raises on a re-run. Routing the rows through
 * `SELECT … WHERE NOT EXISTS` keeps the duplicate out of the trigger's sight entirely.
 *
 * Column names may carry a cast (`"status::ticket_status"`): values in a `VALUES` list resolve to
 * `text` where the literal is untyped, and an INSERT … SELECT will not implicitly cast text onto a
 * uuid, enum or timestamptz column the way a plain INSERT … VALUES does.
 */
export function insertAbsent(
	table: string,
	columns: readonly string[],
	rows: readonly (readonly string[])[],
	idColumn = "id",
): string {
	if (!rows.length) return `-- ${table}: nothing to insert.\n`;
	const names = columns.map((c) => c.split("::")[0]);
	const selects = columns.map((c) => {
		const [name, cast] = c.split("::");
		return cast ? `v.${name}::${cast}` : `v.${name}`;
	});
	const head = `INSERT INTO ${table} (${names.join(", ")})\nSELECT ${
		selects.join(", ")
	}\nFROM (VALUES\n`;
	const body = rows.map((r) => `  (${r.join(", ")})`).join(",\n");
	const tail = `\n) AS v(${
		names.join(", ")
	})\nWHERE NOT EXISTS (SELECT 1 FROM ${table} x WHERE x.${idColumn} = v.${idColumn}::uuid);\n`;
	return head + body + tail;
}

export const HEADER = (title: string, note: string) =>
	`-- =============================================================================================
-- ${title}
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- ${note}
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================

`;
// #endregion
