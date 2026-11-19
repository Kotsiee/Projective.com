/**
 * `deno task cron:vault` — puts the scheduler's Vault secrets where pg_cron's http jobs read them,
 * and proves they are there.
 *
 * pg_cron's http jobs read `CRON_APP_URL` and their bearer (the registry row's `secret_name`) from
 * Vault, and so does the `comms.notifications` dispatch trigger. Without them a job skips and its run
 * still reads as succeeded, so calendars stop syncing, rooms stop being made and notifications stop
 * leaving, with nothing to show why. A database rebuild empties Vault, which is why `db:reset` runs
 * this. The bearer list is read from the registry (`ops.scheduled_jobs`) of the database it writes,
 * so a new job needs no edit here (OPS1, PRD-G6).
 *
 * Modes (`scripts/cron-vault-plan.ts` holds every rule, unit-tested):
 *
 *   (none)             The local container, from `.env.local`: `CRON_APP_URL`, the integrations
 *                      bearer, the dispatcher's (`COMMS_DISPATCH_SECRET`, Decision #344 (a)) and the
 *                      alert sweep's (`OPS_CRON_SECRET`, Decision #461), each only when well formed.
 *                      The money sweeps stay on `deno task cron:run`, so a dev server never moves
 *                      money on a timer. It never fails a reset.
 *   --all              The local container, every bearer the registry names, from `.env.local` then
 *                      `.env` (the app's own view). Opt-in: the money sweeps then run on their timers
 *                      against the dev server, and the next `db:reset` puts back the default.
 *   --env-file <path>  Any database. That file is the env the app's host receives: `APP_URL`,
 *                      `CRON_APP_URL` (default: `APP_URL`'s origin) and every bearer. The
 *                      connection (`CRON_VAULT_DB_URL`, and `CRON_VAULT_DB_CA`, the provider's CA
 *                      certificate file) comes from `--operator-file <path>` when given, which the
 *                      host's file may then not repeat, and otherwise from the same file. Every value
 *                      is vetted first, and all of them are written in one transaction or none is. A
 *                      non-loopback host is reached over verified TLS only.
 *   --check            With either target, read-only: per enabled http job, the bearer is in Vault,
 *                      ≥ 32 characters, digest-equal to the env, scheduled in `cron.job`, and its last
 *                      dispatch; `CRON_APP_URL` passes the target's guard. Exit 1 if any is not ready.
 *
 * No value is read from the command line, printed, logged or written to a file. The check compares
 * sha256 digests computed on each side, so a bearer never leaves the database; a write binds each
 * value as a statement parameter. Exit codes: 0 done or ready · 1 refused or not ready · 2 cannot run.
 */
import { load, parse as parseDotenv } from "@std/dotenv";
import {
	APP_URL_SECRET,
	appUrlProblem,
	bearersFromRegistry,
	type Capabilities,
	CAPABILITIES_SQL,
	checkSql,
	type ConnectionKeys,
	connectionKeys,
	type DbConnection,
	describeVerdict,
	evaluateCheck,
	type ExpectedBearer,
	hostedAppUrl,
	LOCAL_DEFAULT_BEARERS,
	localAppUrl,
	parseArgs,
	parseDbUrl,
	parseRegistry,
	parseVaultState,
	printableOrigin,
	redactor,
	REGISTRY_SQL,
	sha256Hex,
	type Target,
	USAGE,
	VAULT_CREATE_SQL,
	VAULT_ID_SQL,
	VAULT_UPDATE_SQL,
	vetBearers,
} from "./cron-vault-plan.ts";

const CONTAINER = Deno.env.get("PROBES_DB_CONTAINER") ?? "supabase_db_Projective";

// #region The local container
/** Runs SQL in the local container's `postgres` database through psql on stdin. */
async function localPsql(
	sql: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
	const child = new Deno.Command("docker", {
		args: [
			"exec",
			"-i",
			CONTAINER,
			"psql",
			"-U",
			"postgres",
			"-d",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-Atq",
		],
		stdin: "piped",
		stdout: "piped",
		stderr: "piped",
	}).spawn();
	const writer = child.stdin.getWriter();
	await writer.write(new TextEncoder().encode(sql));
	await writer.close();
	const { success, stdout, stderr } = await child.output();
	return {
		success,
		stdout: new TextDecoder().decode(stdout).trim(),
		stderr: new TextDecoder().decode(stderr).trim(),
	};
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The local upsert, unchanged since Decision #386: one `DO` block per secret, on stdin. */
const upsert = (name: string, value: string) => `
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = ${literal(name)}) THEN
        PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = ${literal(name)}), ${
	literal(value)
});
    ELSE
        PERFORM vault.create_secret(${literal(value)}, ${literal(name)});
    END IF;
END $do$;`;

/** Writes `secrets` to the local Vault; true when every name is stored afterwards. */
async function writeLocal(secrets: Record<string, string>): Promise<boolean> {
	const sql = `${Object.entries(secrets).map(([name, value]) => upsert(name, value)).join("\n")}
SELECT count(*) FROM vault.secrets WHERE name IN (${
		Object.keys(secrets).map(literal).join(", ")
	});`;
	const { success, stdout } = await localPsql(sql);
	return success && stdout === String(Object.keys(secrets).length);
}

/** The app's local env: `.env.local` first, then `.env`, as the server loads them. */
async function localEnv(): Promise<Record<string, string>> {
	const read = async (path: string) => {
		try {
			return parseDotenv(await Deno.readTextFile(path));
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) return {};
			throw error;
		}
	};
	return { ...(await read(".env")), ...(await read(".env.local")) };
}
// #endregion

// #region A database by connection string
/** A read-only or writing session on any database. */
interface Session {
	/** `host:port/database`, or the container's name. */
	label: string;
	/** Runs one statement that returns one text value. */
	read(sql: string): Promise<string>;
	close(): Promise<void>;
}

/** The local container as a session; reads only, every statement in a read-only transaction. */
function localSession(): Session {
	return {
		label: `the ${CONTAINER} container`,
		async read(sql) {
			const result = await localPsql(`SET default_transaction_read_only = on;\n${sql}`);
			if (!result.success) {
				throw new Error(result.stderr.split("\n")[0] || "psql failed");
			}
			return result.stdout;
		},
		async close() {},
	};
}

type PgClient = InstanceType<typeof import("@db/postgres").Client>;

/**
 * Connects to `conn`. Loopback is reached in clear; anything else only over TLS that verifies the
 * server against `ca` (or the system roots), never downgraded. The library loads only here, so the
 * local modes, `db:reset`'s hook among them, never need it.
 */
async function connect(conn: DbConnection, ca: string | undefined): Promise<PgClient> {
	const { Client } = await import("@db/postgres");
	const client = new Client({
		hostname: conn.hostname,
		port: conn.port,
		user: conn.user,
		password: conn.password,
		database: conn.database,
		applicationName: "cron-vault",
		connection: { attempts: 1 },
		tls: {
			enabled: !conn.loopback,
			enforce: !conn.loopback,
			caCertificates: ca ? [ca] : [],
		},
	});
	await client.connect();
	return client;
}

/** A read-only session over `client`. */
function remoteSession(client: PgClient, label: string): Session {
	return {
		label,
		async read(sql) {
			const result = await client.queryArray<[string]>(sql);
			return result.rows[0]?.[0] ?? "";
		},
		async close() {
			await client.end();
		},
	};
}

/** An error as one line: a server error's code and message, never its detail or statement. */
function errorText(error: unknown): string {
	const fields = (error as { fields?: { code?: string; message?: string } }).fields;
	if (fields?.message) return `${fields.code ?? "error"}: ${fields.message}`;
	return error instanceof Error ? error.message : String(error);
}
// #endregion

// #region Shared steps
/** Reads which objects exist, refusing a database with no job registry. */
async function capabilities(session: Session): Promise<Capabilities> {
	const caps = JSON.parse(await session.read(CAPABILITIES_SQL)) as Capabilities;
	if (!caps.registry) {
		throw new Error(
			`${session.label} has no ops.scheduled_jobs, so it is not a Projective database`,
		);
	}
	return caps;
}

/** The env side of every bearer the check names: a digest, or why there is none. */
async function expectedBearers(
	names: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
	source: string,
): Promise<Map<string, ExpectedBearer>> {
	const expected = new Map<string, ExpectedBearer>();
	for (const verdict of vetBearers(names, env)) {
		expected.set(
			verdict.name,
			verdict.problem
				? { digest: null, problem: describeVerdict(verdict, source) }
				: { digest: await sha256Hex(env[verdict.name] as string), problem: null },
		);
	}
	return expected;
}

/** Runs the check over `session` and prints it; the exit code. */
async function check(
	session: Session,
	env: Readonly<Record<string, string | undefined>>,
	target: Target,
	source: string,
	print: (line: string) => void,
): Promise<number> {
	const caps = await capabilities(session);
	const state = parseVaultState(JSON.parse(await session.read(checkSql(caps))), caps);
	const names = [...new Set(state.jobs.map((job) => job.secretName))];
	const result = evaluateCheck(state, await expectedBearers(names, env, source), target, source);
	print(`cron:vault --check on ${session.label}, against ${source}:`);
	for (const line of result.lines) print(line);
	return result.ready ? 0 : 1;
}

/** The values a mode holds, so every printed line can be scrubbed of them. */
function secretValues(env: Readonly<Record<string, string | undefined>>): string[] {
	const printable = new Set(["APP_URL", APP_URL_SECRET, "CRON_VAULT_DB_CA", "PORT"]);
	return Object.entries(env)
		.filter(([key, value]) => !printable.has(key) && !!value && value.length >= 8)
		.map(([, value]) => value as string);
}
// #endregion

// #region Modes
/** The `db:reset` hook: unchanged in what it writes and prints, and it never fails a reset. */
async function defaultMode(): Promise<number> {
	const local = await load({ envPath: ".env.local" });

	/** A bearer counts only at 32 characters or more; the `XXXX-XXXX` placeholder never does. */
	const wellFormed = (value: string | undefined): value is string =>
		!!value && value.trim().length >= 32;

	const bearers: Record<string, string> = {};
	for (const name of LOCAL_DEFAULT_BEARERS) {
		const value = local[name];
		if (wellFormed(value)) bearers[name] = value.trim();
		else console.log(`cron:vault: no ${name} in .env.local, so what it guards stays off.`);
	}

	if (Object.keys(bearers).length === 0) return 0;

	const secrets: Record<string, string> = {
		CRON_APP_URL: `http://host.docker.internal:${local.PORT ?? "3000"}`,
		...bearers,
	};
	if (await writeLocal(secrets)) {
		console.log(
			`cron:vault: ${
				Object.keys(secrets).join(", ")
			} set; the scheduler now reaches ${secrets.CRON_APP_URL}.`,
		);
	} else {
		console.error(
			"cron:vault: Vault was not set, so the jobs it guards stay off. Is the database running?",
		);
	}
	return 0;
}

/** `--all`: every registry bearer into the local Vault, with the warning that money now moves. */
async function allMode(): Promise<number> {
	const env = await localEnv();
	const print = (line: string) => console.log(redactor(secretValues(env))(line));
	const session = localSession();
	await capabilities(session);
	const bearers = bearersFromRegistry(parseRegistry(JSON.parse(await session.read(REGISTRY_SQL))));
	const verdicts = vetBearers(bearers.map((b) => b.name), env);

	const secrets: Record<string, string> = { [APP_URL_SECRET]: localAppUrl(env.PORT) };
	let missingRequired = false;
	for (const verdict of verdicts) {
		const bearer = bearers.find((b) => b.name === verdict.name);
		if (!verdict.problem) {
			secrets[verdict.name] = env[verdict.name] as string;
			continue;
		}
		missingRequired ||= !!bearer?.required;
		print(
			`cron:vault --all: ${describeVerdict(verdict, ".env.local / .env")}, so ${
				bearer?.jobs.join(", ")
			} stay off.`,
		);
	}

	if (!(await writeLocal(secrets))) {
		console.error("cron:vault --all: Vault was not set. Is the database running?");
		return 2;
	}
	print(`cron:vault --all: ${Object.keys(secrets).join(", ")} set in ${session.label}.`);
	const defaults: readonly string[] = LOCAL_DEFAULT_BEARERS;
	const timed = bearers
		.filter((b) => secrets[b.name] && !defaults.includes(b.name))
		.flatMap((b) => b.jobs);
	if (timed.length) {
		print(
			`cron:vault --all: WARNING: ${
				timed.join(", ")
			} now run on their timers against the dev server at ${
				secrets[APP_URL_SECRET]
			}. The money sweeps among them charge, pay out and refund as if hosted. The next \`deno task db:reset\` puts back the default.`,
		);
	}
	return missingRequired ? 1 : 0;
}

/** Reads an `--env-file`; `null` (and a message) when it cannot be read. */
async function readEnvFile(path: string): Promise<Record<string, string> | null> {
	try {
		return parseDotenv(await Deno.readTextFile(path));
	} catch (error) {
		console.error(
			`cron:vault: cannot read ${path}: ${
				error instanceof Deno.errors.NotFound ? "no such file" : "unreadable"
			}.`,
		);
		return null;
	}
}

/** An `--env-file` run's inputs: the host's env, where the connection comes from, and a printer. */
interface EnvRun {
	env: Record<string, string>;
	keys: ConnectionKeys;
	print: (line: string) => void;
}

/**
 * Reads the env file the app's host receives and, when given, the operator file beside it, then
 * settles where the connection keys come from. Every line printed afterwards is scrubbed of the
 * values of both files. The exit code instead when they cannot be read (2) or the host's file holds
 * an operator credential (1).
 */
async function loadEnvRun(
	files: { envFile: string; operatorFile?: string },
): Promise<EnvRun | number> {
	const env = await readEnvFile(files.envFile);
	if (!env) return 2;
	const operator = files.operatorFile ? await readEnvFile(files.operatorFile) : null;
	if (files.operatorFile && !operator) return 2;
	const keys = connectionKeys(env, operator, { env: files.envFile, operator: files.operatorFile });
	const redact = redactor([
		...secretValues(env),
		...secretValues(operator ?? {}),
		parseDbUrlPassword(env.CRON_VAULT_DB_URL),
		parseDbUrlPassword(operator?.CRON_VAULT_DB_URL),
	]);
	const print = (line: string) => console.log(redact(line));
	if ("problem" in keys) {
		print(`cron:vault: refused: ${keys.problem}.`);
		return 1;
	}
	return { env, keys, print };
}

/** The `--env-file` / `--operator-file` flags of a run, for the next command it suggests. */
function fileFlags(files: { envFile: string; operatorFile?: string }): string {
	return files.operatorFile
		? `--env-file ${files.envFile} --operator-file ${files.operatorFile}`
		: `--env-file ${files.envFile}`;
}

/** Opens the run's database, refusing a bad connection string or an unreadable CA file. */
async function openEnvDatabase(
	keys: ConnectionKeys,
	print: (line: string) => void,
): Promise<{ client: PgClient; conn: DbConnection } | null> {
	const conn = parseDbUrl(keys.dbUrl);
	if ("problem" in conn) {
		print(`cron:vault: ${conn.problem} in ${keys.source}.`);
		return null;
	}
	let ca: string | undefined;
	if (keys.ca) {
		try {
			ca = await Deno.readTextFile(keys.ca);
		} catch {
			print(`cron:vault: CRON_VAULT_DB_CA in ${keys.source} names a file that cannot be read.`);
			return null;
		}
	}
	try {
		return { client: await connect(conn, ca), conn };
	} catch (error) {
		print(`cron:vault: cannot reach ${conn.label}: ${errorText(error)}`);
		if (!conn.loopback && !ca) {
			print(
				`cron:vault: a hosted database is reached only over verified TLS. Set CRON_VAULT_DB_CA in ${keys.source} to the provider's CA certificate (Supabase: Database settings → SSL configuration).`,
			);
		}
		return null;
	}
}

/** `--env-file <path>`: vet every value, then write them all in one transaction. */
async function writeEnvMode(files: { envFile: string; operatorFile?: string }): Promise<number> {
	const run = await loadEnvRun(files);
	if (typeof run === "number") return run;
	const { env, print } = run;
	const path = files.envFile;
	const opened = await openEnvDatabase(run.keys, print);
	if (!opened) return 2;
	const { client, conn } = opened;
	try {
		const bearers = bearersFromRegistry(
			parseRegistry(JSON.parse((await client.queryArray<[string]>(REGISTRY_SQL)).rows[0][0])),
		);
		const verdicts = vetBearers(bearers.map((b) => b.name), env);
		const refusals: string[] = [];
		const secrets: Record<string, string> = {};
		for (const verdict of verdicts) {
			const bearer = bearers.find((b) => b.name === verdict.name);
			if (!verdict.problem) secrets[verdict.name] = env[verdict.name];
			else if (bearer?.required) {
				refusals.push(`${describeVerdict(verdict, path)} (${bearer.jobs.join(", ")})`);
			} else {
				print(
					`cron:vault: ${
						describeVerdict(verdict, path)
					}; only paused jobs send it, so it is skipped.`,
				);
			}
		}
		const appUrl = hostedAppUrl(env);
		const urlProblem = appUrlProblem(appUrl, { kind: "hosted", appUrl: env.APP_URL });
		if (urlProblem) refusals.push(`${urlProblem} (${path})`);
		if (refusals.length) {
			print(`cron:vault: nothing written to ${conn.label}, because:`);
			for (const refusal of refusals) print(`  - ${refusal}`);
			return 1;
		}
		secrets[APP_URL_SECRET] = appUrl as string;

		const tx = client.createTransaction("cron_vault");
		await tx.begin();
		for (const [name, value] of Object.entries(secrets)) {
			const found = await tx.queryArray<[string]>(VAULT_ID_SQL, [name]);
			if (found.rows.length) await tx.queryArray(VAULT_UPDATE_SQL, [found.rows[0][0], value]);
			else await tx.queryArray(VAULT_CREATE_SQL, [value, name]);
		}
		const stored = await tx.queryArray<[bigint]>(
			"SELECT count(*) FROM vault.secrets WHERE name = ANY($1)",
			[Object.keys(secrets)],
		);
		if (Number(stored.rows[0][0]) !== Object.keys(secrets).length) {
			await tx.rollback();
			print(`cron:vault: Vault in ${conn.label} did not take every value; nothing was written.`);
			return 1;
		}
		await tx.commit();
		const names = Object.keys(secrets).filter((name) => name !== APP_URL_SECRET);
		print(
			`cron:vault: ${APP_URL_SECRET} (${printableOrigin(appUrl)}) and ${names.length} bearers (${
				names.join(", ")
			}) written to ${conn.label}.`,
		);
		print(`cron:vault: now prove it: deno task cron:vault ${fileFlags(files)} --check`);
		return 0;
	} catch (error) {
		print(`cron:vault: nothing written to ${conn.label}: ${errorText(error)}`);
		return 2;
	} finally {
		await client.end();
	}
}

/** The password inside a connection string, for the redactor; never printed. */
function parseDbUrlPassword(value: string | undefined): string | undefined {
	const conn = parseDbUrl(value);
	return "problem" in conn ? undefined : conn.password;
}

/** `--env-file <path> --check`: the read-only check against that run's database. */
async function checkEnvMode(files: { envFile: string; operatorFile?: string }): Promise<number> {
	const run = await loadEnvRun(files);
	if (typeof run === "number") return run;
	const { env, print } = run;
	const opened = await openEnvDatabase(run.keys, print);
	if (!opened) return 2;
	const session = remoteSession(opened.client, opened.conn.label);
	try {
		await opened.client.queryArray("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
		return await check(
			session,
			env,
			{ kind: "hosted", appUrl: env.APP_URL },
			files.envFile,
			print,
		);
	} catch (error) {
		print(`cron:vault --check: ${errorText(error)}`);
		return 2;
	} finally {
		await session.close();
	}
}

/** `--check` against the local container and the app's local env. */
async function checkLocalMode(): Promise<number> {
	const env = await localEnv();
	const print = (line: string) => console.log(redactor(secretValues(env))(line));
	try {
		return await check(
			localSession(),
			env,
			{ kind: "local", port: env.PORT },
			".env.local / .env",
			print,
		);
	} catch (error) {
		print(`cron:vault --check: ${errorText(error)}. Is the database running?`);
		return 2;
	}
}
// #endregion

// #region Entry
/** Runs the mode the command line names; the exit code. */
async function main(args: readonly string[]): Promise<number> {
	const mode = parseArgs(args);
	if ("error" in mode) {
		console.error(`cron:vault: ${mode.error}.`);
		for (const line of USAGE) console.error(line);
		return 2;
	}
	switch (mode.kind) {
		case "help":
			for (const line of USAGE) console.log(line);
			return 0;
		case "default":
			return await defaultMode();
		case "all":
			return await allMode().catch((error) => {
				console.error(`cron:vault --all: ${errorText(error)}. Is the database running?`);
				return 2;
			});
		case "check-local":
			return await checkLocalMode();
		case "write-env":
			return await writeEnvMode(mode);
		case "check-env":
			return await checkEnvMode(mode);
	}
}

if (import.meta.main) Deno.exit(await main(Deno.args));
// #endregion
