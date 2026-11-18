/**
 * The sign-up legal manifest against the database that re-checks it (Decision #446): the versions
 * seeded into `org.legal_document_versions`, the enums and CHECKs of `org.legal_acceptances`, and both
 * tables' columns. A version published on one side only would refuse every sign-up, so it fails here.
 */
import { assertEquals } from "@std/assert";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { LegalAcceptanceRowSchema, LegalDocumentVersionRowSchema } from "./acceptance.ts";
import {
	currentLegalVersion,
	currentLegalVersions,
	LEGAL_ACCEPTANCE_KINDS,
	LEGAL_ACCEPTANCE_SURFACES,
	LEGAL_VERSIONS,
	legalAcceptanceKind,
	SIGNUP_LEGAL_SLUGS,
} from "./manifest.ts";

const SEED = readRepoFile("supabase/migrations/00005050_seed_reference_data.sql");
const ENUMS = readRepoFile("supabase/migrations/00000003_enums_core.sql");
const ORG_SQL = readRepoFile("supabase/migrations/00000011_tables_org.sql");

function enumLabels(type: string): string[] {
	const statement = ENUMS.match(
		new RegExp(`CREATE TYPE ${type.replace(".", "\\.")} AS ENUM \\(([^)]*)\\)`),
	);
	if (!statement) throw new Error(`no CREATE TYPE ${type} in 00000003`);
	return [...statement[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

Deno.test("org.legal_document_versions seeds exactly LEGAL_VERSIONS, newest first per document", () => {
	const statement = SEED.match(/INSERT INTO\s+org\.legal_document_versions\b[^;]*;/);
	if (!statement) throw new Error("no INSERT INTO org.legal_document_versions in 00005050");
	const seeded = [
		...statement[0].matchAll(/\('([^']+)', '([^']+)', '([^']+)', (true|false)\)/g),
	].map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]}`);
	const manifest = SIGNUP_LEGAL_SLUGS.flatMap((slug) =>
		LEGAL_VERSIONS[slug].map((v) => `${slug} ${v.version} ${v.effectiveDate} ${v.material}`)
	);
	assertEquals(seeded, manifest);
});

Deno.test("the acceptance enums are the manifest's vocabularies", () => {
	assertEquals(enumLabels("org.legal_acceptance_kind"), [...LEGAL_ACCEPTANCE_KINDS]);
	assertEquals(enumLabels("org.legal_acceptance_surface"), [...LEGAL_ACCEPTANCE_SURFACES]);
});

Deno.test("org.legal_document_versions and org.legal_acceptances ⇄ their row schemas: zero drift", () => {
	for (
		const [table, schema] of [
			["org.legal_document_versions", LegalDocumentVersionRowSchema],
			["org.legal_acceptances", LegalAcceptanceRowSchema],
		] as const
	) {
		const drift = columnDrift(tableColumns(ORG_SQL, table), Object.keys(schema.shape));
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] }, table);
	}
});

Deno.test("the version CHECK lists every sign-up document", () => {
	const at = ORG_SQL.indexOf("CONSTRAINT legal_document_versions_slug_check");
	const open = ORG_SQL.indexOf("IN (", at) + 4;
	const slugs = [...ORG_SQL.slice(open, ORG_SQL.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((
		m,
	) => m[1]);
	assertEquals(slugs, [...SIGNUP_LEGAL_SLUGS]);
});

Deno.test("the current version is the newest in effect, else the oldest", () => {
	assertEquals(currentLegalVersion("terms", "2026-11-18"), "2.0");
	assertEquals(currentLegalVersion("terms", "2026-09-01"), "1.0");
	assertEquals(currentLegalVersion("terms", "2026-01-01"), "1.0");
	assertEquals(currentLegalVersions("2026-11-18"), {
		terms: "2.0",
		"acceptable-use": "1.0",
		privacy: "1.1",
	});
	assertEquals(currentLegalVersion("privacy", "2026-11-17"), "1.0");
});

Deno.test("privacy is shown, the terms and the AUP are accepted", () => {
	assertEquals(SIGNUP_LEGAL_SLUGS.map(legalAcceptanceKind), ["accepted", "accepted", "shown"]);
});
