/**
 * The identity-core row schemas against the tables that store them (IDENTITY_AND_WORKSPACES audit
 * IW-M9): the person, seller, entity, role and member rows in `00000011_tables_org.sql`, and the
 * acting-context row in `00000012_tables_security.sql`. A column with no Zod key, or a Zod key with
 * no column, fails here the moment either side is edited.
 */
import { assertEquals } from "@std/assert";
import type { z } from "zod";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { SessionContextRowSchema } from "../auth/session-context.ts";
import {
	BusinessMemberRowSchema,
	BusinessProfileRowSchema,
	BusinessRoleRowSchema,
	TeamMemberRowSchema,
	TeamRoleRowSchema,
	TeamRowSchema,
} from "../workspace/rows.ts";
import { EnterpriseMemberSchema, EnterpriseSchema } from "./enterprises.ts";
import { FreelancerProfileRowSchema, UsersPublicRowSchema } from "./identity.ts";

const ORG_SQL = readRepoFile("supabase/migrations/00000011_tables_org.sql");
const SECURITY_SQL = readRepoFile("supabase/migrations/00000012_tables_security.sql");

const ROWS: readonly [sql: string, table: string, schema: z.ZodObject][] = [
	[ORG_SQL, "org.users_public", UsersPublicRowSchema],
	[ORG_SQL, "org.freelancer_profiles", FreelancerProfileRowSchema],
	[ORG_SQL, "org.business_profiles", BusinessProfileRowSchema],
	[ORG_SQL, "org.teams", TeamRowSchema],
	[ORG_SQL, "org.business_roles", BusinessRoleRowSchema],
	[ORG_SQL, "org.team_roles", TeamRoleRowSchema],
	[ORG_SQL, "org.business_members", BusinessMemberRowSchema],
	[ORG_SQL, "org.team_members", TeamMemberRowSchema],
	[ORG_SQL, "org.enterprises", EnterpriseSchema],
	[ORG_SQL, "org.enterprise_members", EnterpriseMemberSchema],
	[SECURITY_SQL, "security.session_context", SessionContextRowSchema],
];

for (const [sql, table, schema] of ROWS) {
	Deno.test(`${table} ⇄ its row schema: zero drift`, () => {
		const drift = columnDrift(tableColumns(sql, table), Object.keys(schema.shape));
		assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
	});
}

Deno.test("the role and member CHECK vocabularies are the Zod enums", () => {
	const literals = (anchor: string) => {
		const at = ORG_SQL.indexOf(anchor);
		const open = ORG_SQL.indexOf("IN (", at) + 4;
		return [...ORG_SQL.slice(open, ORG_SQL.indexOf(")", open)).matchAll(/'([^']*)'/g)].map((m) =>
			m[1]
		);
	};
	assertEquals(literals("CONSTRAINT ck_team_role_base"), [
		...TeamRoleRowSchema.shape.basePreset.options,
	]);
	assertEquals(literals("CONSTRAINT ck_business_role_base"), [
		...BusinessRoleRowSchema.shape.basePreset.options,
	]);
	assertEquals(literals("CONSTRAINT ck_team_member_role"), [
		...TeamMemberRowSchema.shape.role.options,
	]);
	assertEquals(literals("CONSTRAINT ck_business_member_role"), [
		...BusinessMemberRowSchema.shape.role.options,
	]);
	assertEquals(literals("CONSTRAINT ck_team_member_status"), [
		...TeamMemberRowSchema.shape.status.options,
	]);
	assertEquals(literals("CONSTRAINT teams_status_check"), [...TeamRowSchema.shape.status.options]);
	assertEquals(literals("CONSTRAINT business_profiles_visibility_check"), [
		...BusinessProfileRowSchema.shape.visibility.options,
	]);
	assertEquals(literals("CONSTRAINT users_public_visibility_check"), [
		...UsersPublicRowSchema.shape.visibility.options,
	]);
});

Deno.test("a session context names one acting slot at most", () => {
	const base = {
		userId: "00000000-0000-4000-8000-000000000001",
		activeProfileType: null,
		activeProfileId: null,
		activeTeamId: null,
		activeEnterpriseId: null,
		updatedAt: "2026-10-30T00:00:00Z",
	};
	const id = "00000000-0000-4000-8000-000000000002";
	assertEquals(SessionContextRowSchema.safeParse(base).success, true);
	assertEquals(SessionContextRowSchema.safeParse({ ...base, activeTeamId: id }).success, true);
	assertEquals(SessionContextRowSchema.safeParse({ ...base, activeProfileId: id }).success, false);
	assertEquals(
		SessionContextRowSchema.safeParse({ ...base, activeTeamId: id, activeEnterpriseId: id })
			.success,
		false,
	);
});
