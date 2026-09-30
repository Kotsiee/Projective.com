/**
 * The cross-check between the payments SSOT and the migrations that store it (Decision #125).
 *
 * Every status this module speaks is also spelled in SQL — an enum, a CHECK, or a literal list a
 * definer function tests — and a CHECK that has fallen out of step still parses, still applies, and
 * simply starts refusing a status the application believes is legal (or, worse, a webhook handler
 * starts matching nothing). A type-checker cannot see it: SQL is a string to TypeScript.
 *
 * So this reads the migration FILES and asserts each SQL vocabulary equals its Zod enum, member for
 * member and in order where order is meaningful. Deliberately a test over file content rather than a
 * live query, so it fails on a laptop with no database at the moment one side is edited.
 */
import { assert, assertEquals } from "@std/assert";
import {
	EscrowLockStatus,
	HANDLED_STRIPE_EVENTS,
	InboundPaymentPurpose,
	InboundPaymentStatus,
	PayoutAccountOwnerType,
	PayoutAccountStatus,
	PayoutStatus,
} from "./payments.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const ENUMS_SQL = read("supabase/migrations/00000004_enums_domains.sql");
const TABLES_SQL = read("supabase/migrations/00000017_tables_finance.sql");
const FUNCTIONS_SQL = read("supabase/migrations/00001230_functions_finance_stripe.sql");
const GRANTS_SQL = read("supabase/migrations/00002510_permissions_function_grants.sql");

/** The quoted literals of the first `(...)` list after `anchor` in `sql`. */
function literalsAfter(sql: string, anchor: RegExp): string[] {
	const at = sql.search(anchor);
	assert(at >= 0, `anchor not found: ${anchor}`);
	const open = sql.indexOf("(", at);
	const close = sql.indexOf(")", open);
	return [...sql.slice(open + 1, close).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** The body of `CREATE TABLE <name> (...)` up to its closing `);`. */
function tableBody(name: string): string {
	const start = TABLES_SQL.indexOf(`CREATE TABLE ${name} (`);
	assert(start >= 0, `${name} not found`);
	return TABLES_SQL.slice(start, TABLES_SQL.indexOf("\n);", start));
}

Deno.test("finance.inbound_payment_status is InboundPaymentStatus, member for member, in order", () => {
	assertEquals(
		literalsAfter(ENUMS_SQL, /CREATE TYPE finance\.inbound_payment_status AS ENUM/),
		[...InboundPaymentStatus.options],
	);
});

Deno.test("inbound_payments.purpose and lock_status CHECKs match their Zod enums", () => {
	const body = tableBody("finance.inbound_payments");
	assertEquals(literalsAfter(body, /purpose text NOT NULL CHECK/), [
		...InboundPaymentPurpose.options,
	]);
	assertEquals(literalsAfter(body, /lock_status IN/), [...EscrowLockStatus.options]);
});

Deno.test("payout_accounts status and owner_type CHECKs match their Zod enums", () => {
	const body = tableBody("finance.payout_accounts");
	assertEquals(literalsAfter(body, /CHECK \(status IN/), [...PayoutAccountStatus.options]);
	assertEquals(literalsAfter(body, /CHECK \(owner_type IN/), [...PayoutAccountOwnerType.options]);
});

Deno.test("the processor doors accept exactly the statuses the SSOT defines", () => {
	// sync_payout_account validates its p_status against the same four words.
	assertEquals(
		literalsAfter(FUNCTIONS_SQL, /p_status NOT IN \('pending_verification'/),
		[...PayoutAccountStatus.options],
	);
	// record_card_payment_failure writes only the two terminal-ish failure statuses.
	const failure = literalsAfter(FUNCTIONS_SQL, /p_status NOT IN \('failed'/);
	assertEquals(failure, ["failed", "canceled"]);
	for (const status of failure) assert(InboundPaymentStatus.options.includes(status as never));
});

Deno.test("every identity event the webhook handles is one apply_identity_event accepts", () => {
	const accepted = literalsAfter(FUNCTIONS_SQL, /IF p_event_type NOT IN \(/);
	const handled = HANDLED_STRIPE_EVENTS.filter((type) => type.startsWith("identity."));
	assertEquals([...handled].sort(), [...accepted].sort());
});

Deno.test("no processor door is executable by a client role", () => {
	const doors = [
		"settle_card_payment",
		"record_card_payment_failure",
		"apply_identity_event",
		"sync_payout_account",
		"record_transfer_created",
		"record_dispute_opened",
		// Decision #126 (00001240): a client who could call these could announce its own chargeback won,
		// its own payout sent or failed back, a card saved against somebody else, or a scheduled charge run.
		"record_dispute_closed",
		"complete_payout",
		"fail_payout",
		"record_saved_card",
		"claim_due_deposit_rules",
		"bind_scheduled_payment",
	];
	for (const door of doors) {
		const revoke = new RegExp(
			`REVOKE ALL ON FUNCTION finance\\.${door} \\([^)]*\\) FROM PUBLIC, anon, authenticated;`,
		);
		const grant = new RegExp(
			`GRANT EXECUTE ON FUNCTION finance\\.${door} \\([^)]*\\) TO service_role;`,
		);
		assert(revoke.test(GRANTS_SQL), `${door} is not revoked from the client roles`);
		assert(grant.test(GRANTS_SQL), `${door} is not granted to service_role`);
		assert(
			!new RegExp(`GRANT EXECUTE ON FUNCTION finance\\.${door} [^;]*authenticated`).test(
				GRANTS_SQL,
			),
			`${door} is granted to authenticated`,
		);
	}
});

Deno.test("a closed dispute's outcome is one finance.chargeback_status can hold", () => {
	const statuses = literalsAfter(ENUMS_SQL, /CREATE TYPE finance\.chargeback_status AS ENUM/);
	// record_dispute_closed writes exactly these two resolutions.
	for (const status of ["won", "lost"]) assert(statuses.includes(status), status);
});

Deno.test("the withdrawal payout statuses are PayoutStatus, member for member", () => {
	assertEquals(
		literalsAfter(ENUMS_SQL, /CREATE TYPE finance\.payout_status AS ENUM/),
		[...PayoutStatus.options],
	);
});
