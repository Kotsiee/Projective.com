/**
 * emit-entities.ts — `03_entities.sql`: teams and businesses, their system roles, memberships,
 * pending invitations, team payout splits, follows and bookmarks.
 */

import { ago, ahead, arr, enumArr, HEADER, id, insert, jsonb, num, q, uuidFor } from "./sql.ts";
import { persona, project, type World } from "./resolve.ts";
import { BOOKMARKS, FOLLOWS } from "./world.ts";

const TEAM_ROLES: Array<[name: string, perms: string[]]> = [
	["Owner", [
		"manage_profile",
		"manage_portfolio",
		"manage_members",
		"manage_roles",
		"manage_services",
		"manage_projects",
		"send_messages",
		"manage_finances",
	]],
	["Lead", ["manage_portfolio", "manage_services", "manage_projects", "send_messages"]],
	["Admin", [
		"manage_profile",
		"manage_portfolio",
		"manage_members",
		"manage_services",
		"manage_projects",
		"send_messages",
	]],
	["Member", ["send_messages"]],
];

const BUSINESS_ROLES: Array<[title: string, perms: string[]]> = [
	["Owner", [
		"manage_profile",
		"manage_members",
		"manage_roles",
		"manage_hiring",
		"manage_projects",
		"manage_billing",
		"manage_escrow",
	]],
	["Admin", [
		"manage_profile",
		"manage_members",
		"manage_hiring",
		"manage_projects",
		"manage_escrow",
	]],
	["Member", ["manage_projects"]],
];

export function teamRoleId(teamKey: string, role: string): string {
	return uuidFor("team_role", `${teamKey}:${role.toLowerCase()}`);
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
				"member_limit",
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
				t.teamPlan ? "15" : "5",
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
			["id", "team_id", "name", "summary", "permissions", "is_system"],
			teams.flatMap((t) =>
				TEAM_ROLES.map(([name, perms]) => [
					id(teamRoleId(t.key, name)),
					id(t.entityId),
					q(name),
					q(`${name} of ${t.name}`),
					enumArr(perms, "org.team_permission"),
					"true",
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
				"role",
				"status",
				"default_split_share",
				"invited_by",
				"title",
				"joined_at",
				"created_at",
			],
			teams.flatMap((t) =>
				t.members.map((m) => {
					const p = persona(world, m.persona);
					return [
						id(uuidFor("team_member", `${t.key}:${m.persona}`)),
						id(t.entityId),
						id(p.userId),
						q(m.role),
						"'active'",
						m.splitBp !== undefined ? (m.splitBp / 100).toFixed(2) : "NULL",
						m.role === "owner" ? "NULL" : id(t.ownerUserId),
						q(m.title),
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
					String(m.role === "owner"),
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
			["id", "business_id", "title", "summary", "permissions", "is_system"],
			businesses.flatMap((b) =>
				BUSINESS_ROLES.map(([title, perms]) => [
					id(uuidFor("business_role", `${b.key}:${title.toLowerCase()}`)),
					id(b.entityId),
					q(title),
					q(`${title} of ${b.name}`),
					enumArr(perms, "org.business_permission"),
					"true",
				])
			),
		),
	);

	out.push(
		insert(
			"org.business_members",
			["id", "business_id", "user_id", "role", "status", "title", "joined_at"],
			businesses.flatMap((b) =>
				b.members.map((m) => [
					id(uuidFor("business_member", `${b.key}:${m.persona}`)),
					id(b.entityId),
					id(persona(world, m.persona).userId),
					q(m.role),
					"'active'",
					q(m.title),
					ago(m.joinedDaysAgo),
				])
			),
			"(business_id, user_id)",
		),
	);

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
				"role_id",
				"token",
				"note",
				"status",
				"expires_at",
				"created_at",
			],
			[...world.entities.values()].flatMap((e) =>
				(e.pendingInvites ?? []).map((inv) => {
					const target = persona(world, inv.persona);
					const roleName = inv.role === "admin" ? "Admin" : "Member";
					return [
						id(uuidFor("org_invitation", `${e.key}:${inv.persona}`)),
						id(e.ownerUserId),
						id(target.userId),
						q(target.handle),
						e.kind === "team" ? id(e.entityId) : "NULL",
						e.kind === "business" ? id(e.entityId) : "NULL",
						id(
							e.kind === "team"
								? teamRoleId(e.key, roleName)
								: uuidFor("business_role", `${e.key}:${roleName.toLowerCase()}`),
						),
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
