/**
 * emit-entities.ts — `03_entities.sql`: teams and businesses, their system roles, memberships,
 * pending invitations, team payout splits, follows and bookmarks.
 */

import { ago, ahead, arr, enumArr, HEADER, id, insert, jsonb, num, q, uuidFor } from "./sql.ts";
import { persona, project, type World } from "./resolve.ts";
import { BOOKMARKS, FOLLOWS } from "./world.ts";

/**
 * The preset roles every entity is created with (org.fn_seed_preset_roles). A preset row stores NO
 * capabilities — they are org.fn_preset_capabilities(preset, kind), the SQL twin of @projective/types
 * workspace PRESET_GRANTS — so the seed writes only the name, the one-line remit and the preset.
 */
const PRESETS: Array<[preset: string, name: string, summary: string]> = [
	["owner", "Owner", "Full authority, including archiving and transferring ownership."],
	["admin", "Admin", "Runs the roster, the money and the settings — everything but archiving."],
	["lead", "Lead", "Binds the team to seats and runs delivery, without restructuring the roster."],
	["member", "Member", "Does the work and sees how the entity is performing."],
];
/** A business roster has no `lead` (seat-binding is seller-side authority). */
const BUSINESS_PRESETS = PRESETS.filter(([preset]) => preset !== "lead");

export function teamRoleId(teamKey: string, role: string): string {
	return uuidFor("team_role", `${teamKey}:${role.toLowerCase()}`);
}

export function businessRoleId(businessKey: string, role: string): string {
	return uuidFor("business_role", `${businessKey}:${role.toLowerCase()}`);
}

function memberId(kind: "team" | "business", entityKey: string, personaKey: string): string {
	return uuidFor(kind === "team" ? "team_member" : "business_member", `${entityKey}:${personaKey}`);
}

export function emitEntities(world: World): string {
	const out: string[] = [
		HEADER(
			"03_entities.sql — teams and businesses, roles, memberships, invitations, follows",
			"A team is a Freelancer with multiple members (seller side); a business is a Client with multiple members (buyer side). Owners and members were seeded in 01; brand images in 02.",
		),
	];

	const teams = [...world.entities.values()].filter((e) => e.kind === "team");
	const businesses = [...world.entities.values()].filter((e) => e.kind === "business");

	// #region Teams
	out.push(
		insert(
			"org.teams",
			[
				"id",
				"owner_user_id",
				"name",
				"slug",
				"avatar_file_id",
				"banner_file_id",
				"headline",
				"bio",
				"visibility",
				"subscription_tier",
				"payout_model",
				"current_workload_intensity",
				"available_since",
				"status",
				"created_at",
			],
			teams.map((t) => [
				id(t.entityId),
				id(t.ownerUserId),
				q(t.name),
				q(t.slug),
				id(world.entityAvatar.get(t.key)?.id),
				id(world.entityBanner.get(t.key)?.id),
				q(t.headline),
				jsonb({ text: t.bio }),
				"'public'",
				q(t.teamPlan ? "pro" : "free"),
				"'split_rules'",
				"30",
				ago(Math.min(t.createdDaysAgo, 14)),
				"'active'",
				ago(t.createdDaysAgo),
			]),
		),
	);

	out.push(
		insert(
			"org.team_roles",
			["id", "team_id", "name", "summary", "preset", "base_preset"],
			teams.flatMap((t) =>
				PRESETS.map(([preset, name, summary]) => [
					id(teamRoleId(t.key, preset)),
					id(t.entityId),
					q(name),
					q(summary),
					q(preset),
					q(preset),
				])
			),
		),
	);

	out.push(
		insert(
			"org.team_members",
			[
				"id",
				"team_id",
				"user_id",
				"role_id",
				"role",
				"status",
				"invited_by",
				"title",
				"granted_capabilities",
				"joined_at",
				"created_at",
			],
			teams.flatMap((t) =>
				t.members.map((m) => {
					const p = persona(world, m.persona);
					return [
						id(memberId("team", t.key, m.persona)),
						id(t.entityId),
						id(p.userId),
						id(teamRoleId(t.key, m.role)),
						q(m.role),
						"'active'",
						m.role === "owner" ? "NULL" : id(t.ownerUserId),
						q(m.title),
						enumArr(m.granted ?? [], "org.workspace_capability"),
						ago(m.joinedDaysAgo),
						ago(m.joinedDaysAgo),
					];
				})
			),
			"(team_id, user_id)",
		),
	);

	out.push(
		insert(
			"finance.contribution_agreements",
			["id", "team_id", "member_user_id", "percent_bp", "held"],
			teams.flatMap((t) =>
				t.members.filter((m) => m.splitBp !== undefined).map((m) => [
					id(uuidFor("contribution", `${t.key}:${m.persona}`)),
					id(t.entityId),
					id(persona(world, m.persona).userId),
					String(m.splitBp),
					// Nobody's stake starts held: `held` is a choice made in the split editor, not a
					// privilege of the owner.
					"false",
				])
			),
			"(team_id, member_user_id)",
		),
	);

	out.push(
		insert(
			"finance.split_rules",
			["id", "team_id", "rule_type", "vault_bp", "active"],
			teams.map((
				t,
			) => [id(uuidFor("split_rule", t.key)), id(t.entityId), "'co_op'", "1000", "true"]),
		),
	);
	// #endregion

	// #region Businesses
	out.push(
		insert(
			"org.business_profiles",
			[
				"id",
				"owner_user_id",
				"name",
				"slug",
				"legal_name",
				"logo_file_id",
				"banner_file_id",
				"country",
				"billing_email",
				"plan",
				"headline",
				"bio",
				"languages",
				"timezone",
				"default_currency",
				"tax_id",
				"address_city",
				"invoicing_mode",
				"billing_day",
				"status",
				"kyb_status",
				"kyb_verified_at",
				"kyb_provider_ref",
				"created_at",
			],
			businesses.map((b) => [
				id(b.entityId),
				id(b.ownerUserId),
				q(b.name),
				q(b.slug),
				q(b.legalName),
				id(world.entityAvatar.get(b.key)?.id),
				id(world.entityBanner.get(b.key)?.id),
				q(b.country),
				q(b.billingEmail),
				"'free'",
				q(b.headline),
				jsonb({ text: b.bio }),
				arr(["English"]),
				q(b.timezone),
				"'USD'",
				q(b.taxId),
				q(b.city),
				q(b.invoicingMode ?? "per_transaction"),
				num(b.billingDay ?? null),
				"'active'",
				q(b.kyb ?? "unverified"),
				b.kyb === "verified" ? ago(b.createdDaysAgo - 5) : "NULL",
				b.kyb && b.kyb !== "unverified" ? q(`acct_seed_${b.slug}`) : "NULL",
				ago(b.createdDaysAgo),
			]),
		),
	);

	out.push(
		insert(
			"org.business_roles",
			["id", "business_id", "name", "summary", "preset", "base_preset"],
			businesses.flatMap((b) =>
				BUSINESS_PRESETS.map(([preset, name, summary]) => [
					id(businessRoleId(b.key, preset)),
					id(b.entityId),
					q(name),
					q(summary),
					q(preset),
					q(preset),
				])
			),
		),
	);

	out.push(
		insert(
			"org.business_members",
			[
				"id",
				"business_id",
				"user_id",
				"role_id",
				"role",
				"status",
				"invited_by",
				"title",
				"granted_capabilities",
				"joined_at",
				"created_at",
			],
			businesses.flatMap((b) =>
				b.members.map((m) => [
					id(memberId("business", b.key, m.persona)),
					id(b.entityId),
					id(persona(world, m.persona).userId),
					id(businessRoleId(b.key, m.role)),
					q(m.role),
					"'active'",
					m.role === "owner" ? "NULL" : id(b.ownerUserId),
					q(m.title),
					enumArr(m.granted ?? [], "org.workspace_capability"),
					ago(m.joinedDaysAgo),
					ago(m.joinedDaysAgo),
				])
			),
			"(business_id, user_id)",
		),
	);

	// The org chart, written after both rosters exist (an edge points at a MEMBERSHIP row).
	for (const e of [...teams, ...businesses]) {
		for (const m of e.members) {
			if (!m.reportsTo) continue;
			const table = e.kind === "team" ? "org.team_members" : "org.business_members";
			out.push(
				`UPDATE ${table} SET reports_to = ${id(memberId(e.kind, e.key, m.reportsTo))} WHERE id = ${
					id(memberId(e.kind, e.key, m.persona))
				};`,
			);
		}
	}
	out.push("");

	out.push(
		insert(
			"finance.verification_cases",
			[
				"id",
				"subject_type",
				"subject_id",
				"kind",
				"status",
				"tier",
				"provider",
				"provider_ref",
				"submitted_at",
				"decided_at",
				"notes",
			],
			businesses.filter((b) => b.kyb && b.kyb !== "unverified").map((b) => [
				id(uuidFor("kyb", b.key)),
				"'business'",
				id(b.entityId),
				"'kyb'",
				q(b.kyb!),
				"3",
				"'stripe_identity'",
				q(`acct_seed_${b.slug}`),
				ago(b.createdDaysAgo - 4),
				b.kyb === "verified" ? ago(b.createdDaysAgo - 5) : "NULL",
				b.kyb === "pending" ? q("Company registration document under review.") : "NULL",
			]),
		),
	);
	// #endregion

	// #region Invitations, follows, bookmarks
	out.push(
		insert(
			"org.org_invitations",
			[
				"id",
				"inviter_user_id",
				"target_user_id",
				"target_handle",
				"team_id",
				"business_id",
				"team_role_id",
				"business_role_id",
				"token",
				"note",
				"status",
				"expires_at",
				"created_at",
			],
			[...world.entities.values()].flatMap((e) =>
				(e.pendingInvites ?? []).map((inv) => {
					const target = persona(world, inv.persona);
					return [
						id(uuidFor("org_invitation", `${e.key}:${inv.persona}`)),
						id(e.ownerUserId),
						id(target.userId),
						q(target.handle),
						e.kind === "team" ? id(e.entityId) : "NULL",
						e.kind === "business" ? id(e.entityId) : "NULL",
						e.kind === "team" ? id(teamRoleId(e.key, inv.role)) : "NULL",
						e.kind === "business" ? id(businessRoleId(e.key, inv.role)) : "NULL",
						q(uuidFor("org_invitation_token", `${e.key}:${inv.persona}`)),
						q(inv.note),
						"'pending'",
						ahead(14 - inv.daysAgo),
						ago(inv.daysAgo),
					];
				})
			),
		),
	);

	out.push(
		insert(
			"org.profile_follows",
			["id", "follower_user_id", "target_entity_type", "target_entity_id", "created_at"],
			FOLLOWS.map(([follower, target], i) => {
				const f = persona(world, follower);
				const t = world.personas.get(target);
				const e = world.entities.get(target);
				if (!t && !e) throw new Error(`world: follow target "${target}" is unknown`);
				return [
					id(uuidFor("follow", `${follower}:${target}`)),
					id(f.userId),
					q(t ? "user" : e!.kind),
					id(t ? t.userId : e!.entityId),
					ago(3 + (i * 7) % 60),
				];
			}),
			"(follower_user_id, target_entity_type, target_entity_id)",
		),
	);

	out.push(
		insert(
			"org.user_bookmarks",
			["id", "user_id", "entity_type", "entity_id"],
			BOOKMARKS.map((b) => {
				let target: string;
				switch (b.type) {
					case "freelancer":
						target = persona(world, b.target).userId;
						break;
					case "team":
					case "business":
						target = world.entities.get(b.target)!.entityId;
						break;
					case "project":
						target = project(world, b.target).projectId;
						break;
					case "service_blueprint":
						target = world.serviceId(b.target);
						break;
				}
				return [
					id(uuidFor("bookmark", `${b.persona}:${b.type}:${b.target}`)),
					id(persona(world, b.persona).userId),
					q(b.type),
					id(target),
				];
			}),
			"(user_id, entity_type, entity_id)",
		),
	);
	// #endregion

	return out.join("\n");
}
