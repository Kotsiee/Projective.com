/**
 * The data export request row against the table that stores it (Decision #450): every column of
 * `org.data_export_requests` has its Zod key and none is extra, and the status and failure CHECK
 * vocabularies are the Zod enums. The policy constants are checked against the 00001061 definers.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import {
	DATA_EXPORT_POLICY,
	DataExportFailure,
	DataExportRefusal,
	DataExportRequestRowSchema,
	DataExportStatus,
} from "./data-export.ts";
import { DataExportDomain } from "./data-export-archive.ts";

const ORG_SQL = readRepoFile("supabase/migrations/00000011_tables_org.sql");
const DOORS_SQL = readRepoFile("supabase/migrations/00001061_functions_org_data_export.sql");

function literals(anchor: string): string[] {
	const at = ORG_SQL.indexOf(anchor);
	const open = ORG_SQL.indexOf("IN (", at) + 4;
	return [...ORG_SQL.slice(open, ORG_SQL.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((m) =>
		m[1]
	);
}

Deno.test("org.data_export_requests ⇄ DataExportRequestRowSchema: zero drift", () => {
	const drift = columnDrift(
		tableColumns(ORG_SQL, "org.data_export_requests"),
		Object.keys(DataExportRequestRowSchema.shape),
	);
	assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
});

Deno.test("the status and failure CHECK vocabularies are the Zod enums", () => {
	assertEquals(literals("CONSTRAINT data_export_requests_status_check"), [
		...DataExportStatus.options,
	]);
	assertEquals(literals("CONSTRAINT data_export_requests_reason_check"), [
		...DataExportFailure.options,
	]);
});

Deno.test("every refusal the doors raise is a DataExportRefusal code", () => {
	const raised = [...DOORS_SQL.matchAll(/RAISE EXCEPTION '([a-z_]+)' USING ERRCODE = 'P0001'/g)]
		.map((m) => m[1]);
	assertEquals([...new Set(raised)].sort(), [...DataExportRefusal.options].sort());
});

Deno.test("the doors use the policy's windows", () => {
	assertStringIncludes(DOORS_SQL, `interval '${DATA_EXPORT_POLICY.linkDays} days'`);
	assertStringIncludes(DOORS_SQL, `interval '${DATA_EXPORT_POLICY.cooldownHours} hours'`);
	assertStringIncludes(DOORS_SQL, `interval '${DATA_EXPORT_POLICY.recentSignInMinutes} minutes'`);
	assertStringIncludes(DOORS_SQL, `attempts >= ${DATA_EXPORT_POLICY.maxAttempts}`);
});

Deno.test("security.collect_data_export answers exactly the archive's domains", () => {
	const at = DOORS_SQL.indexOf("CREATE OR REPLACE FUNCTION security.collect_data_export");
	const body = DOORS_SQL.slice(at, DOORS_SQL.indexOf("$$;", DOORS_SQL.indexOf("AS $$", at)));
	const domains = [...body.matchAll(/WHEN '([a-z_]+)' THEN org\.fn_export_\1\(/g)].map((m) => m[1]);
	assertEquals(domains, [...DataExportDomain.options]);
});
