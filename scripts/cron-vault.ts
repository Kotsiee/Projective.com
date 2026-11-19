/**
 * `deno task cron:vault` — points the local scheduler at the local app, so the integrations jobs and
 * the notification dispatcher run.
 *
 * pg_cron's http jobs read `CRON_APP_URL` and their bearer from Vault, and so does the
 * `comms.notifications` dispatch trigger. Without them a job skips and its run still reads as
 * succeeded, so calendars stop syncing, rooms stop being made and notifications stop leaving, with
 * nothing to show why. A database rebuild empties Vault, which is why `db:reset` runs this.
 *
 * Only the integrations bearer, the dispatcher's (`COMMS_DISPATCH_SECRET`, Decision #344 (a)) and the
 * alert sweep's (`OPS_CRON_SECRET`, Decision #461) go in, each only when `.env.local` holds a
 * well-formed one; alerts move no money. The money sweeps stay on
 * `deno task cron:run`, so a dev server never moves money on a timer. Notifications move none, and
 * outbound delivery still waits for the `comms.dispatch_webhook` flag. Local only: a hosted database is
 * set by hand (SYSTEM_ARCHITECTURE §Scheduled jobs). It never fails a reset, and it prints names, never
 * a value.
 */
import { load } from "@std/dotenv";

const CONTAINER = Deno.env.get("PROBES_DB_CONTAINER") ?? "supabase_db_Projective";
const local = await load({ envPath: ".env.local" });

/** A bearer counts only at 32 characters or more; the `XXXX-XXXX` placeholder never does. */
const wellFormed = (value: string | undefined): value is string =>
	!!value && value.trim().length >= 32;

const bearers: Record<string, string> = {};
for (const name of ["INTEGRATIONS_CRON_SECRET", "COMMS_DISPATCH_SECRET", "OPS_CRON_SECRET"]) {
	const value = local[name];
	if (wellFormed(value)) bearers[name] = value.trim();
	else console.log(`cron:vault: no ${name} in .env.local, so what it guards stays off.`);
}

if (Object.keys(bearers).length === 0) Deno.exit(0);

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

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

const secrets: Record<string, string> = {
	CRON_APP_URL: `http://host.docker.internal:${local.PORT ?? "3000"}`,
	...bearers,
};
const sql = `${Object.entries(secrets).map(([name, value]) => upsert(name, value)).join("\n")}
SELECT count(*) FROM vault.secrets WHERE name IN (${
	Object.keys(secrets).map(literal).join(", ")
});`;

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
const { success, stdout } = await child.output();

const stored = new TextDecoder().decode(stdout).trim();
if (success && stored === String(Object.keys(secrets).length)) {
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
