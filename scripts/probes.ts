/**
 * `deno task test:probes` — runs every `supabase/probes/*.sql` against the local Supabase database and
 * prints a per-probe pass/fail summary.
 *
 * A probe signals failure by raising: each file sets `\set ON_ERROR_STOP on` and asserts through a
 * `pg_temp` helper that does `RAISE EXCEPTION 'PROBE FAIL: …'`, so psql exits non-zero on the first
 * failed assertion or on any SQL error. The runner treats exit 0 as pass and anything else as fail,
 * and quotes the first `ERROR:` line psql printed.
 *
 * Probes run one at a time through `docker exec -i <container> psql -U postgres -d postgres -X -q`,
 * the invocation every probe header documents, so no host psql is needed. Most probes run inside one
 * transaction that they roll back. `ON_ERROR_STOP=1` is passed on the command line for every probe. The
 * concurrency probes (those gated on `:{?disposable}` or on the `probe.allow_commit` setting) commit
 * their fixtures and races, so they are SKIPPED unless `--disposable` is passed, which supplies both
 * gates — pass it only against a database about to be thrown away, as `deno task test:probes:fresh`
 * does right after `db:reset`.
 *
 *   deno task test:probes [--disposable] [--verbose] [--timeout=<seconds>] [name …]
 *
 * `name` filters by file basename (with or without `.sql`). `--verbose` prints a failing probe's full
 * psql output. `PROBES_DB_CONTAINER` overrides the container (default `supabase_db_Projective`).
 * Exits 0 when every probe that ran passed, 1 when any failed, 2 when the database is unreachable.
 * `supabase/probes/*.ts` probes need a running app server and are not run here.
 */

// #region Options
const PROBES_DIR = "supabase/probes";
const CONTAINER = Deno.env.get("PROBES_DB_CONTAINER") ?? "supabase_db_Projective";
// ON_ERROR_STOP is forced here, not trusted to each file: a probe without it carries on in autocommit
// after a failed guard and still exits 0.
const PSQL = ["psql", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"];
// Committing probes open dblink sessions, and only a superuser may open one without a password.
const psqlUser = (commits: boolean) => ["-U", commits ? "supabase_admin" : "postgres"];
// The two markers a committing probe uses to refuse the shared database.
const COMMIT_MARKERS = [":{?disposable}", "probe.allow_commit"];

const flags = Deno.args.filter((a) => a.startsWith("--"));
const names = Deno.args.filter((a) => !a.startsWith("--")).map((n) => n.replace(/\.sql$/, ""));
const disposable = flags.includes("--disposable");
const verbose = flags.includes("--verbose");
const timeoutSec = Number(flags.find((f) => f.startsWith("--timeout="))?.split("=")[1] ?? 180);
// #endregion

// #region Probe execution
/** Outcome of one probe file. */
interface ProbeResult {
	name: string;
	status: "pass" | "fail" | "skip";
	ms: number;
	detail: string;
}

const decoder = new TextDecoder();

async function psql(sql: string, commits = false): Promise<{ code: number; out: string }> {
	const env = commits ? ["-e", "PGOPTIONS=-c probe.allow_commit=on"] : [];
	const vars = commits ? ["-v", "disposable=1"] : [];
	const child = new Deno.Command("docker", {
		args: ["exec", "-i", ...env, CONTAINER, ...PSQL, ...psqlUser(commits), ...vars],
		stdin: "piped",
		stdout: "piped",
		stderr: "piped",
	}).spawn();
	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutSec * 1000);
	const writer = child.stdin.getWriter();
	await writer.write(new TextEncoder().encode(sql));
	await writer.close();
	const { code, stdout, stderr } = await child.output();
	clearTimeout(timer);
	return { code, out: decoder.decode(stdout) + decoder.decode(stderr) };
}

/** The line that explains a failure: psql's first `ERROR:` line, else the last non-empty line. */
function reason(out: string): string {
	const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const err = lines.find((l) => /\bERROR:/.test(l));
	return (err ?? lines.at(-1) ?? "no output").replace(/^psql:<stdin>:\d+:\s*/, "");
}

async function runProbe(name: string, sql: string): Promise<ProbeResult> {
	const commits = COMMIT_MARKERS.some((m) => sql.includes(m));
	if (commits && !disposable) {
		return { name, status: "skip", ms: 0, detail: "commits; needs --disposable" };
	}
	const started = performance.now();
	const { code, out } = await psql(sql, commits);
	const ms = Math.round(performance.now() - started);
	if (code === 0) return { name, status: "pass", ms, detail: "" };
	if (verbose) console.error(`\n--- ${name} (exit ${code}) ---\n${out.trimEnd()}\n`);
	const detail = code === 137 ? `timed out after ${timeoutSec}s` : reason(out);
	return { name, status: "fail", ms, detail };
}
// #endregion

// #region Main
const probe = await psql("SELECT 1;");
if (probe.code !== 0) {
	console.error(`Cannot reach the database in container ${CONTAINER}: ${reason(probe.out)}`);
	console.error("Start the local stack (`npx supabase start`) or set PROBES_DB_CONTAINER.");
	Deno.exit(2);
}

const files: string[] = [];
for await (const entry of Deno.readDir(PROBES_DIR)) {
	if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
	const name = entry.name.replace(/\.sql$/, "");
	if (names.length === 0 || names.includes(name)) files.push(name);
}
if (files.length === 0) {
	console.error(`No probe matched ${names.join(", ")} in ${PROBES_DIR}.`);
	Deno.exit(2);
}
const sources = new Map<string, string>();
for (const name of files) sources.set(name, await Deno.readTextFile(`${PROBES_DIR}/${name}.sql`));
// Committing probes run last: the seed rows they leave behind would break the fixtures of later probes.
const commitsRank = (name: string) =>
	Number(COMMIT_MARKERS.some((m) => sources.get(name)!.includes(m)));
files.sort((a, b) => commitsRank(a) - commitsRank(b) || a.localeCompare(b));

const results: ProbeResult[] = [];
for (const name of files) {
	const result = await runProbe(name, sources.get(name)!);
	results.push(result);
	const tag = { pass: "PASS", fail: "FAIL", skip: "SKIP" }[result.status];
	const time = result.status === "skip" ? "" : ` (${result.ms} ms)`;
	console.log(`${tag}  ${name}${time}${result.detail ? `  — ${result.detail}` : ""}`);
}

const count = (s: ProbeResult["status"]) => results.filter((r) => r.status === s).length;
const failed = results.filter((r) => r.status === "fail");
console.log(
	`\n${results.length} probes: ${count("pass")} passed, ${failed.length} failed, ${
		count("skip")
	} skipped.`,
);
if (failed.length > 0) {
	console.log("Failed:");
	for (const r of failed) console.log(`  ${r.name}  — ${r.detail}`);
	Deno.exit(1);
}
// #endregion
