import { assert, assertEquals } from "@std/assert";
import { type BackendGate, MOCK_DOMAINS, MOCK_REGISTRY, type MockDomain } from "./registry.ts";

/**
 * The registry describes the service layer as it is (LD3, PRD-B4). This test reads the code, not the
 * registry's prose: it lists `packages/backend/services/*` and, for every directory, scans the
 * non-test sources for a database call and for the `is*BackendLive` predicate they consult. Every
 * directory that reaches the database must have an entry, and every entry's `gate` and
 * `liveImplemented` must agree with what the scan finds. A new service, a gate added or removed, or a
 * stale entry fails here instead of drifting.
 *
 * It also pins "no flag is dead": every `*_BACKEND_LIVE` the server reads (`core/env.ts`) is the gate
 * of some entry, every gate is offered in `.env.example`, and every predicate `core/supabase.ts`
 * exports is consulted by some service.
 */

// #region Scan
const BACKEND = new URL("../", import.meta.url);
const SERVICES = new URL("services/", BACKEND);
const REPO = new URL("../../", BACKEND);

/** Array-likes whose static `.from(` is not a Supabase query builder. */
const BUILTIN_FROM =
	"Array|Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|Buffer|Object|Set|Map|Iterator";

/**
 * A database call: a PostgREST `.rpc(` or `.from(` (a table, a schema-qualified table or a storage
 * bucket), a Supabase client factory, or one of the core storage helpers that call Supabase for you.
 */
const DB_CALL = new RegExp(
	String
		.raw`\.rpc\(|(?<!\b(?:${BUILTIN_FROM}))\.from\(|\bget(?:User|Service|Anon|OAuth)Client\(|core/storage-(?:signed|stream)\.ts`,
);

/** A reference to a per-domain gate predicate, e.g. `isProjectsBackendLive`. */
const PREDICATE = /\bis([A-Z][A-Za-z]*)BackendLive\b/g;

/** `isProjectsBackendLive` → `PROJECTS_BACKEND_LIVE`. */
function gateOfPredicate(camel: string): string {
	return `${camel.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_BACKEND_LIVE`;
}

/** Drop comment lines (`//`, `/*`, JSDoc `*`) so prose that names a call or a gate is not counted. */
function code(source: string): string {
	return source.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join("\n");
}

function* sources(dir: URL): Generator<URL> {
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isDirectory) yield* sources(new URL(`${entry.name}/`, dir));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			yield new URL(entry.name, dir);
		}
	}
}

interface DirScan {
	/** The directory has at least one database call in its non-test sources. */
	touchesDb: boolean;
	/** The gates its predicates name, sorted. */
	gates: string[];
}

function scan(dir: string): DirScan {
	let touchesDb = false;
	const gates = new Set<string>();
	for (const file of sources(new URL(`${dir}/`, SERVICES))) {
		const text = code(Deno.readTextFileSync(file));
		if (DB_CALL.test(text)) touchesDb = true;
		for (const match of text.matchAll(PREDICATE)) gates.add(gateOfPredicate(match[1]));
	}
	return { touchesDb, gates: [...gates].sort() };
}

const SERVICE_DIRS = [...Deno.readDirSync(SERVICES)]
	.filter((entry) => entry.isDirectory)
	.map((entry) => entry.name)
	.sort();

const SCANS = new Map(SERVICE_DIRS.map((dir) => [dir, scan(dir)]));

/** Every gate some entry uses. */
const USED_GATES: readonly BackendGate[] = [
	...new Set(
		MOCK_DOMAINS.map((d) => MOCK_REGISTRY[d].gate).filter((g): g is BackendGate => g !== null),
	),
];

function isDomain(dir: string): dir is MockDomain {
	return Object.hasOwn(MOCK_REGISTRY, dir);
}
// #endregion

// #region Registry ⇄ code
Deno.test("the scan sees the service layer (guards against a scanner that finds nothing)", () => {
	assert(
		SERVICE_DIRS.length >= 20,
		`expected the service directories, found ${SERVICE_DIRS.length}`,
	);
	assert(SCANS.get("projects")?.touchesDb, "projects reaches the database");
	assertEquals(SCANS.get("projects")?.gates, ["PROJECTS_BACKEND_LIVE"]);
});

Deno.test("every service directory that reaches the database has a registry entry", () => {
	const missing = SERVICE_DIRS.filter((dir) => SCANS.get(dir)!.touchesDb && !isDomain(dir));
	assertEquals(missing, [], `services with database calls and no MOCK_REGISTRY entry: ${missing}`);
});

Deno.test("every registry entry is a service directory", () => {
	const stray = MOCK_DOMAINS.filter((domain) => !SCANS.has(domain));
	assertEquals(
		stray,
		[],
		`MOCK_REGISTRY entries with no packages/backend/services/<dir>: ${stray}`,
	);
});

Deno.test("each entry's liveImplemented matches whether its code reaches the database", () => {
	for (const domain of MOCK_DOMAINS) {
		const found = SCANS.get(domain)?.touchesDb ?? false;
		assertEquals(
			MOCK_REGISTRY[domain].liveImplemented,
			found,
			`${domain}: registry says liveImplemented=${MOCK_REGISTRY[domain].liveImplemented}, code ${
				found ? "has" : "has no"
			} database call`,
		);
	}
});

Deno.test("each entry's gate is the predicate its code consults (or null when it consults none)", () => {
	for (const domain of MOCK_DOMAINS) {
		const { gate } = MOCK_REGISTRY[domain];
		assertEquals(
			SCANS.get(domain)?.gates ?? [],
			gate ? [gate] : [],
			`${domain}: registry gate ${gate ?? "null"} disagrees with the predicates its code calls`,
		);
	}
});
// #endregion

// #region Entry shape
Deno.test("an always-live entry says why, and has no fixture road", () => {
	for (const domain of MOCK_DOMAINS) {
		const info = MOCK_REGISTRY[domain];
		if (info.gate) continue;
		assert(info.alwaysLive?.trim(), `${domain}: gate null needs a one-line alwaysLive reason`);
		assertEquals(info.fixtureRoad, false, `${domain}: an ungated domain has no fixture road`);
		assertEquals(info.gated, [], `${domain}: an ungated domain gates nothing`);
	}
});

Deno.test("a gated entry names what its gate covers", () => {
	for (const domain of MOCK_DOMAINS) {
		const info = MOCK_REGISTRY[domain];
		if (!info.gate) continue;
		assert(info.gated.length > 0, `${domain}: list the sub-features ${info.gate} covers`);
		assertEquals(info.alwaysLive, undefined, `${domain}: a gated entry is not always-live`);
	}
});

Deno.test("every fixture module the registry names exists", () => {
	for (const domain of MOCK_DOMAINS) {
		for (const module of MOCK_REGISTRY[domain].modules) {
			const url = new URL(module, BACKEND);
			let exists = false;
			try {
				exists = Deno.statSync(url).isFile;
			} catch { /* reported below */ }
			assert(exists, `${domain}: ${module} does not exist under packages/backend/`);
		}
	}
});
// #endregion

// #region No dead flag
Deno.test("every *_BACKEND_LIVE the server reads is some entry's gate", () => {
	const env = Deno.readTextFileSync(new URL("core/env.ts", BACKEND));
	const read = [...env.matchAll(/firstEnv\("([A-Z_]+_BACKEND_LIVE)"\)/g)].map((m) => m[1]).sort();
	const used = new Set(USED_GATES);
	assert(read.length > 0, "env.ts reads the backend gates");
	const dead = read.filter((flag) => !used.has(flag as BackendGate));
	assertEquals(dead, [], `flags env.ts reads that gate no registry domain: ${dead}`);
});

Deno.test("every predicate core/supabase.ts exports is consulted by a service", () => {
	const supabase = code(Deno.readTextFileSync(new URL("core/supabase.ts", BACKEND)));
	const exported = [...supabase.matchAll(/export function is([A-Z][A-Za-z]*)BackendLive\(/g)]
		.map((m) => gateOfPredicate(m[1]));
	const consulted = new Set([...SCANS.values()].flatMap((s) => s.gates));
	const dead = exported.filter((gate) => !consulted.has(gate));
	assertEquals(dead, [], `predicates no service consults: ${dead}`);
});

Deno.test(".env.example offers exactly the gates the registry uses", () => {
	const example = Deno.readTextFileSync(new URL(".env.example", REPO));
	const offered = [...example.matchAll(/^([A-Z_]+_BACKEND_LIVE)=/gm)].map((m) => m[1]).sort();
	assertEquals(offered, [...USED_GATES].sort());
});
// #endregion
