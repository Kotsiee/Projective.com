/**
 * `deno task cron:vault` — points the local scheduler at the local app, so the integrations jobs run.
 *
 * pg_cron's http jobs read `CRON_APP_URL` and their bearer from Vault. Without them a job skips and its
 * run still reads as succeeded, so calendars stop syncing and rooms stop being made with nothing to show
 * why. A database rebuild empties Vault, which is why `db:reset` runs this.
 *
 * Only the integrations bearer goes in: the money sweeps stay on `deno task cron:run`, so a dev server
 * never moves money on a timer. Local only: a hosted database is set by hand (SYSTEM_ARCHITECTURE
 * §Scheduled jobs). It never fails a reset, and it prints names, never a value.
 */
import { load } from "@std/dotenv";

const CONTAINER = Deno.env.get("PROBES_DB_CONTAINER") ?? "supabase_db_Projective";
const local = await load({ envPath: ".env.local" });
const bearer = local.INTEGRATIONS_CRON_SECRET;

if (!bearer || bearer.length < 32) {
	console.log("cron:vault: no INTEGRATIONS_CRON_SECRET in .env.local, so the integrations jobs stay off.");
	Deno.exit(0);
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

const upsert = (name: string, value: string) => `
DO $do$ BEGIN
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = ${literal(name)}) THEN
        PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = ${literal(name)}), ${literal(value)});
    ELSE
        PERFORM vault.create_secret(${literal(value)}, ${literal(name)});
    END IF;
END $do$;`;

const secrets = {
	CRON_APP_URL: `http://host.docker.internal:${local.PORT ?? "3000"}`,
	INTEGRATIONS_CRON_SECRET: bearer,
};
const sql = `${Object.entries(secrets).map(([name, value]) => upsert(name, value)).join("\n")}
SELECT count(*) FROM vault.secrets WHERE name IN (${Object.keys(secrets).map(literal).join(", ")});`;

const child = new Deno.Command("docker", {
	args: ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
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
	console.log(`cron:vault: the integrations jobs now reach ${secrets.CRON_APP_URL}.`);
} else {
	console.error("cron:vault: Vault was not set, so the integrations jobs stay off. Is the database running?");
}
