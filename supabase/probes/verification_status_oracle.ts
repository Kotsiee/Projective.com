/**
 * Probe: `GET /api/auth/verification-status` as an account-existence oracle (Decision #185).
 *
 * Start the app (`deno task dev`), then:
 *   deno run -A supabase/probes/verification_status_oracle.ts [origin]
 *
 * Before the fix the route took `?email=` and answered `{ verified }` from a service-role read of
 * that address, so a registered (confirmed) persona and an unregistered address answered
 * differently with no credential at all. After the fix the poll answers only for the account named by
 * the signed `pj_pending_verification` cookie: without it, every address gets the identical body.
 */
const origin = Deno.args[0] ?? "http://localhost:5373";
const SEEDED = "aikotanaka@projective.dev";
const UNKNOWN = "no-such-account-185@projective.dev";

const rows = [];
for (const email of [SEEDED, UNKNOWN]) {
	const url = `${origin}/api/auth/verification-status?email=${
		encodeURIComponent(email)
	}&redirectTo=/home`;
	const res = await fetch(url);
	rows.push({ email, status: res.status, body: await res.text() });
}
console.table(rows);
const same = rows[0].status === rows[1].status && rows[0].body === rows[1].body;
console.log(same ? "UNIFORM: no account signal" : "ORACLE: answers differ by account");
if (!same) Deno.exit(1);
