/**
 * The contact SSOT and its migrations agree, literal for literal (Decision #276). The writer re-checks
 * everything a direct PostgREST call could send, so a list that drifts between the two is either a
 * field the form sends and the database refuses, or a value the database accepts that no reader
 * expects. Reads the migration text (the `catalog.contract.test.ts` technique) — no database.
 */
import { assert, assertEquals } from "@std/assert";
import { BUCKETS } from "../files/storage.ts";
import { AssetPurpose } from "../files/variants.ts";
import {
	CONTACT_BUDGETS,
	CONTACT_COMPANY_SIZES,
	CONTACT_DB_CEILINGS,
	CONTACT_INTENTS,
	CONTACT_LIMITS,
	CONTACT_PAYLOAD_KEYS,
	CONTACT_REFERENCE_ALPHABET,
	CONTACT_REFERENCE_PATTERN,
	CONTACT_REQUEST_STATUSES,
	CONTACT_SECURITY_REPORTS,
	CONTACT_STATUS_TRANSITIONS,
	CONTACT_SUPPORT_TOPICS,
	ContactBudget,
	ContactCompanySize,
	ContactEngagementRefSchema,
	type ContactRequestStatus,
	ContactSecurityReport,
	ContactSupportTopic,
} from "./intake.ts";

const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const read = (file: string) =>
	Deno.readTextFileSync(new URL(file, MIGRATIONS)).replace(/\r\n/g, "\n");

const TABLES = read("00000013_tables_ops.sql");
const DOOR = read("00001655_functions_ops_contact.sql");
const BUCKET_SEED = read("00005040_seed_storage_buckets.sql");
const ENUMS = read("00000004_enums_domains.sql");

/** The quoted literals of `<column> = ANY (ARRAY['a'::text, …])` in a named CHECK. */
function checkValues(sql: string, constraint: string): string[] {
	const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(\\w+ = ANY \\(ARRAY\\[([^\\]]*)\\]\\)\\)`)
		.exec(sql);
	assert(m, `${constraint} not found`);
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

Deno.test("intents: the table's CHECK and the writer's guard are CONTACT_INTENTS", () => {
	assertEquals(checkValues(TABLES, "contact_requests_intent_check"), [...CONTACT_INTENTS]);
	const guard = /p_intent NOT IN \(([^)]*)\)/.exec(DOOR);
	assert(guard, "the writer's intent guard");
	assertEquals([...guard[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...CONTACT_INTENTS]);
});

Deno.test("statuses: the table's CHECK is CONTACT_REQUEST_STATUSES", () => {
	assertEquals(checkValues(TABLES, "contact_requests_status_check"), [...CONTACT_REQUEST_STATUSES]);
	assert(/status text NOT NULL DEFAULT 'backlog'/.test(TABLES), "a request arrives in backlog");
});

Deno.test("transitions: the record guard allows exactly CONTACT_STATUS_TRANSITIONS", () => {
	const allowed = new Map<string, string[]>();
	for (
		const m of DOOR.matchAll(/OLD\.status = '(\w+)' AND NEW\.status (?:IN \(([^)]*)\)|= '(\w+)')/g)
	) {
		const to = m[2] ? [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [m[3]];
		allowed.set(m[1], to);
	}
	for (const from of CONTACT_REQUEST_STATUSES) {
		assertEquals(allowed.get(from) ?? [], [
			...CONTACT_STATUS_TRANSITIONS[from as ContactRequestStatus],
		], from);
	}
});

Deno.test("reference: the table's CHECK and the generator's alphabet are the TypeScript twin's", () => {
	const check = /contact_requests_reference_check CHECK \(reference ~ '([^']+)'\)/.exec(TABLES);
	assert(check, "reference CHECK");
	assertEquals(check[1], CONTACT_REFERENCE_PATTERN.source);
	const alphabet = /v_alphabet constant text := '([^']+)'/.exec(DOOR);
	assert(alphabet, "generator alphabet");
	assertEquals(alphabet[1], CONTACT_REFERENCE_ALPHABET);
});

Deno.test("payload keys: the writer's whitelist per intent is CONTACT_PAYLOAD_KEYS", () => {
	const block = /v_allowed := CASE p_intent([\s\S]*?)END;/.exec(DOOR);
	assert(block, "the whitelist");
	const lists = new Map<string, string[]>();
	for (const m of block[1].matchAll(/WHEN '(\w+)' THEN ARRAY\[([^\]]*)\]/g)) {
		lists.set(m[1], [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]));
	}
	const otherwise = /ELSE ARRAY\[([^\]]*)\]/.exec(block[1]);
	assert(otherwise, "the ELSE arm");
	lists.set("security", [...otherwise[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
	for (const intent of CONTACT_INTENTS) {
		assertEquals(lists.get(intent), [...CONTACT_PAYLOAD_KEYS[intent]], intent);
	}
});

Deno.test("limits: message, name, email and attachment counts match the writer and the table", () => {
	assert(DOOR.includes(`< ${CONTACT_LIMITS.messageMin}`), "message minimum");
	assert(DOOR.includes(`> ${CONTACT_LIMITS.messageMax}`), "message maximum");
	assert(TABLES.includes(`BETWEEN 1 AND ${CONTACT_LIMITS.messageMax}`), "message CHECK");
	assert(DOOR.includes(`NOT BETWEEN 1 AND ${CONTACT_LIMITS.name}`), "name");
	assert(
		DOOR.includes(`> ${CONTACT_LIMITS.email}`) && TABLES.includes(`<= ${CONTACT_LIMITS.email}`),
		"email",
	);
	assert(DOOR.includes(`cardinality(v_ids) > ${CONTACT_LIMITS.attachments}`), "attachments");
});

Deno.test("ceilings: the writer's hourly PR429 limits are CONTACT_DB_CEILINGS", () => {
	assert(
		DOOR.includes(`IF v_recent >= ${CONTACT_DB_CEILINGS.perEmailPerHour} THEN`),
		"per address",
	);
	assert(DOOR.includes(`IF v_recent >= ${CONTACT_DB_CEILINGS.perUserPerHour} THEN`), "per account");
	assert(DOOR.includes(`IF v_recent >= ${CONTACT_DB_CEILINGS.guestPerHour} THEN`), "guests");
	assert(DOOR.includes(`IF v_recent >= ${CONTACT_DB_CEILINGS.anonymousPerHour} THEN`), "anonymous");
	assertEquals((DOOR.match(/ERRCODE = 'PR429'/g) ?? []).length, 4);
	assert(
		/WHERE r\.user_id IS NULL AND NOT r\.anonymous AND r\.created_at > v_now - interval '1 hour'/
			.test(DOOR),
		"the guest ceiling counts named requests without an account",
	);
});

/** The quoted literals of `<name> constant text[] := ARRAY[…];` in the writer's declarations. */
function declaredList(name: string): string[] {
	const m = new RegExp(`${name} constant text\\[\\] := ARRAY\\[([^\\]]*)\\];`).exec(DOOR);
	assert(m, `${name} not declared`);
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

Deno.test("closed choices: the writer's lists are the SSOT's, value for value", () => {
	assertEquals(declaredList("v_company_sizes"), CONTACT_COMPANY_SIZES.map((o) => o.value));
	assertEquals(declaredList("v_company_sizes"), [...ContactCompanySize.options]);
	assertEquals(declaredList("v_budgets"), CONTACT_BUDGETS.map((o) => o.value));
	assertEquals(declaredList("v_budgets"), [...ContactBudget.options]);
	assertEquals(declaredList("v_topics"), CONTACT_SUPPORT_TOPICS.map((o) => o.value));
	assertEquals(declaredList("v_topics"), [...ContactSupportTopic.options]);
	assertEquals(declaredList("v_reports"), CONTACT_SECURITY_REPORTS.map((o) => o.value));
	assertEquals(declaredList("v_reports"), [...ContactSecurityReport.options]);
	assertEquals(declaredList("v_formats"), [
		...ContactEngagementRefSchema.shape.format.options,
	]);
});

Deno.test("field values: the writer caps each free-text key at the SSOT's limit", () => {
	assert(
		DOOR.includes(
			`pg_catalog.btrim(p_payload ->> 'company')) NOT BETWEEN 1 AND ${CONTACT_LIMITS.company}`,
		),
		"company",
	);
	assert(
		DOOR.includes(
			`pg_catalog.btrim(p_payload ->> 'referenceId')) NOT BETWEEN 1 AND ${CONTACT_LIMITS.referenceId}`,
		),
		"referenceId",
	);
	assert(
		DOOR.includes(`pg_catalog.length(p_payload ->> 'accountEmail') > ${CONTACT_LIMITS.email}`),
		"accountEmail",
	);
	const ref = ContactEngagementRefSchema.shape;
	assert(DOOR.includes(`NOT BETWEEN 1 AND ${ref.slug.maxLength}`), "engagement slug");
	assert(DOOR.includes(`NOT BETWEEN 1 AND ${ref.title.maxLength}`), "engagement title");
	assert(DOOR.includes("WHERE k NOT IN ('slug', 'title', 'format')"), "engagement keys");
});

Deno.test("sender: a request is keyed on the identity, so an account mid-/join can send one", () => {
	assert(
		/contact_requests_user_id_fkey FOREIGN KEY \(user_id\) REFERENCES auth\.users \(id\) ON DELETE SET NULL/
			.test(TABLES),
		"user_id references auth.users, not org.users_public",
	);
});

Deno.test("bucket: the seed row is BUCKETS.contact", () => {
	const m = /VALUES \(\s*'contact',\s*'contact',\s*(true|false),\s*(\d+),\s*ARRAY\[([^\]]*)\]/.exec(
		BUCKET_SEED,
	);
	assert(m, "the contact bucket seed");
	assertEquals(m[1], "false");
	assertEquals(Number(m[2]), BUCKETS.contact.maxBytes);
	assertEquals([...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]), [
		...(BUCKETS.contact.allowedMime ?? []),
	]);
});

Deno.test("files.asset_purpose carries `contact`, member for member with AssetPurpose", () => {
	const m = /CREATE TYPE files\.asset_purpose AS ENUM \(([^)]*)\);/.exec(ENUMS);
	assert(m, "asset_purpose");
	assertEquals([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...AssetPurpose.options]);
});
