/**
 * emit-identities.ts — `01_identities.sql`: auth accounts, public profiles, freelancer profiles,
 * skills, languages, preferences and verification cases.
 */

import { ago, arr, HEADER, id, insert, jsonb, q, splitName, uuidFor } from "./sql.ts";
import type { World } from "./resolve.ts";
import { SKILLS } from "./world.ts";

export const DEV_PASSWORD = "password123";

export function emitIdentities(world: World): string {
	const out: string[] = [
		HEADER(
			"01_identities.sql — auth accounts, public profiles and freelancer profiles",
			`Seventeen development personas (see gen/world.ts). Every account signs in with the password '${DEV_PASSWORD}' at <username>@projective.dev. Triggers stay ENABLED: public.handle_new_user is a no-op without username/dob metadata, and the users_public triggers are what seed each person's preference rows and search index.`,
		),
	];

	// Skills vocabulary the personas reference.
	out.push(
		insert(
			"org.skills",
			["id", "slug", "label"],
			SKILLS.map(([slug, label]) => [id(uuidFor("skill", slug)), q(slug), q(label)]),
			"(slug)",
		),
	);

	const personas = [...world.personas.values()];

	out.push(
		"-- The token columns are seeded as EMPTY STRINGS, not left NULL, and that is load-bearing.",
		"-- GoTrue scans confirmation_token / recovery_token / email_change* / phone_change* /",
		"-- reauthentication_token into non-nullable Go strings. A NULL in any of them makes every",
		"-- sign-in fail with a 500 'Database error querying schema' — which reads like a broken",
		"-- database rather than a bad seed, and is why this is spelled out here.",
	);
	out.push(
		insert(
			"auth.users",
			[
				"instance_id",
				"id",
				"aud",
				"role",
				"email",
				"encrypted_password",
				"email_confirmed_at",
				"last_sign_in_at",
				"created_at",
				"updated_at",
				"raw_app_meta_data",
				"raw_user_meta_data",
				"confirmation_token",
				"recovery_token",
				"email_change",
				"email_change_token_new",
				"email_change_token_current",
				"phone_change",
				"phone_change_token",
				"reauthentication_token",
			],
			personas.map((p) => [
				"'00000000-0000-0000-0000-000000000000'",
				id(p.userId),
				"'authenticated'",
				"'authenticated'",
				q(p.email),
				`crypt(${q(DEV_PASSWORD)}, gen_salt('bf'))`,
				ago(p.joinedDaysAgo),
				ago(Math.min(p.joinedDaysAgo, 1)),
				ago(p.joinedDaysAgo),
				ago(p.joinedDaysAgo),
				`'{"provider":"email","providers":["email"]}'`,
				// No `username`/`dob` keys on purpose: their presence is what makes handle_new_user
				// provision a profile, and the profile row is written explicitly below.
				jsonb({ full_name: p.name, name: p.name }),
				"''",
				"''",
				"''",
				"''",
				"''",
				"''",
				"''",
				"''",
			]),
		),
	);

	// GoTrue reads identities to list providers; a seeded account without one still signs in, but
	// the admin UI shows it as provider-less. One email identity per account keeps it honest.
	out.push(
		insert(
			"auth.identities",
			[
				"id",
				"user_id",
				"provider_id",
				"provider",
				"identity_data",
				"last_sign_in_at",
				"created_at",
				"updated_at",
			],
			personas.map((p) => [
				id(uuidFor("identity", p.handle)),
				id(p.userId),
				id(p.userId),
				"'email'",
				jsonb({ sub: p.userId, email: p.email, email_verified: true }),
				ago(p.joinedDaysAgo),
				ago(p.joinedDaysAgo),
				ago(p.joinedDaysAgo),
			]),
			"(provider_id, provider)",
		),
	);

	out.push(
		insert(
			"org.users_public",
			[
				"user_id",
				"username",
				"first_name",
				"last_name",
				"headline",
				"city",
				"country",
				"timezone",
				"languages",
				"dob",
				"visibility",
				"bio",
				"interests",
				"is_freelancer",
				"is_operator",
				"has_team",
				"has_business",
				"created_at",
				"updated_at",
			],
			personas.map((p) => {
				const { first, last } = splitName(p.name);
				const memberOfTeam = [...world.entities.values()].some((e) =>
					e.kind === "team" && e.members.some((m) => m.persona === p.key)
				);
				const memberOfBusiness = [...world.entities.values()].some((e) =>
					e.kind === "business" && e.members.some((m) => m.persona === p.key)
				);
				return [
					id(p.userId),
					q(p.handle),
					q(first),
					q(last),
					q(p.headline),
					q(p.city),
					q(p.country),
					q(p.timezone),
					arr(p.languages),
					q(p.dob),
					"'public'",
					jsonb({ text: p.bio }),
					arr(p.interests),
					String(p.role === "freelancer"),
					String(p.role === "operator"),
					String(memberOfTeam),
					String(memberOfBusiness),
					ago(p.joinedDaysAgo),
					ago(Math.min(p.joinedDaysAgo, 2)),
				];
			}),
			"(user_id)",
		),
	);

	out.push(
		insert(
			"org.user_emails",
			["id", "user_id", "email", "is_primary", "verified_at", "created_at"],
			personas.map((p) => [
				id(uuidFor("email", p.handle)),
				id(p.userId),
				q(p.email),
				"true",
				ago(p.joinedDaysAgo),
				ago(p.joinedDaysAgo),
			]),
		),
	);

	// The users_public trigger already seeded a default preferences row; this only sets the
	// persona's display currency and locale on top of it.
	out.push(
		"INSERT INTO org.user_preferences (user_id, preferred_display_currency, locale, theme)\nVALUES",
	);
	out.push(
		personas.map((p) =>
			`  (${id(p.userId)}, ${q(p.displayCurrency ?? "GBP")}, ${q(localeFor(p.country))}, 'system')`
		).join(",\n"),
	);
	out.push(
		"ON CONFLICT (user_id) DO UPDATE SET preferred_display_currency = EXCLUDED.preferred_display_currency, locale = EXCLUDED.locale;\n",
	);

	const freelancers = personas.filter((p) => p.role === "freelancer");
	out.push(
		insert(
			"org.freelancer_profiles",
			[
				"user_id",
				"skills",
				"availability_status",
				"current_workload_intensity",
				"max_workload_intensity",
				"available_since",
				"kyc_status",
				"kyc_tier",
				"kyc_verified_at",
				"payout_ready",
				"identity_provider_ref",
				"created_at",
			],
			freelancers.map((p) => {
				const load = p.workload ?? 0;
				const kyc = p.kyc ?? "unverified";
				return [
					id(p.userId),
					arr(p.skills),
					q(load >= 60 ? "busy" : "available"),
					String(Math.round(load / 20)),
					"5.00",
					ago(Math.min(p.joinedDaysAgo, 14)),
					q(kyc),
					kyc === "verified" ? "2" : "NULL",
					kyc === "verified" ? ago(Math.min(p.joinedDaysAgo - 1, 60)) : "NULL",
					String(!!p.payoutReady),
					kyc === "unverified" ? "NULL" : q(`vs_seed_${p.handle}`),
					ago(p.joinedDaysAgo),
				];
			}),
			"(user_id)",
		),
	);

	out.push(
		insert(
			"org.user_skills",
			["user_id", "skill_id", "proficiency"],
			personas.flatMap((p) =>
				p.skills.map((slug, i) => [
					id(p.userId),
					id(uuidFor("skill", slug)),
					String(Math.max(3, 5 - Math.floor(i / 2))),
				])
			),
			"(user_id, skill_id)",
		),
	);

	out.push(
		insert(
			"org.user_languages",
			["user_id", "code", "level"],
			personas.flatMap((p) =>
				p.languageLevels.map(([code, level]) => [id(p.userId), q(code), q(level)])
			),
			"(user_id, code)",
		),
	);

	out.push(
		insert(
			"org.profile_links",
			["id", "profile_type", "profile_id", "kind", "url", "is_public"],
			personas.flatMap((p) =>
				(p.links ?? []).map(([kind, url]) => [
					id(uuidFor("link", `${p.handle}:${kind}`)),
					"'user'",
					id(p.userId),
					q(kind),
					q(url),
					"true",
				])
			),
		),
	);

	// KYC cases: one per freelancer whose state is not the untouched default.
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
			freelancers.filter((p) => (p.kyc ?? "unverified") !== "unverified").map((p) => [
				id(uuidFor("kyc", p.handle)),
				"'freelancer'",
				id(p.userId),
				"'kyc'",
				q(p.kyc!),
				"2",
				"'stripe_identity'",
				q(`vs_seed_${p.handle}`),
				ago(Math.min(p.joinedDaysAgo - 1, 61)),
				p.kyc === "verified" ? ago(Math.min(p.joinedDaysAgo - 1, 60)) : "NULL",
				p.kyc === "pending" ? q("Document uploaded; awaiting provider decision.") : "NULL",
			]),
		),
	);

	return out.join("\n");
}

function localeFor(country: string): string {
	switch (country) {
		case "United Kingdom":
		case "Ireland":
		case "United Arab Emirates":
		case "Nigeria":
			return "en-GB";
		case "Canada":
			return "en-CA";
		case "Germany":
			return "de-DE";
		case "Portugal":
			return "pt-PT";
		case "Brazil":
			return "pt-BR";
		case "Poland":
			return "pl-PL";
		case "Japan":
			return "ja-JP";
		default:
			return "en-GB";
	}
}
