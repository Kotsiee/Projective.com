/**
 * generate.ts — emit `supabase/seeds/*.sql` from the consolidated mock corpus.
 *
 * ## Why the seed is generated rather than hand-written
 *
 * The seed and the fixtures describe the same world. Written separately they drift, and the drift is
 * invisible: a developer running `supabase db reset` sees a plausible database that simply disagrees
 * with what the app renders when its gates are off. Deriving the SQL from
 * `@projective/backend/mocks` makes that impossible by construction — the same `SERVICES` array
 * produces both the card on `/explore` and the row in `marketplace.service_blueprints`.
 *
 * The generated `.sql` files ARE committed. A generator alone would make `supabase db reset` depend
 * on a Deno run; committed output keeps the standard Supabase workflow working with no toolchain,
 * while this script stays the way to regenerate after the corpus changes:
 *
 *     deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
 *
 * ## Identity: deterministic UUIDs, not random ones
 *
 * Every row's primary key is derived from a stable natural key (`@handle`, a listing id) through
 * {@link uuidFor}. Two consequences matter. A re-run produces byte-identical SQL, so regenerating
 * shows an empty diff unless the corpus actually changed. And every insert can be
 * `ON CONFLICT DO NOTHING`, which makes the seed idempotent — running it twice, or against a
 * partially-seeded database, is safe rather than a primary-key collision.
 *
 * ## Ordering
 *
 * File numbers ARE the dependency order: identities before the entities that reference them, entities
 * before listings, listings before the search index that projects them. `config.toml`'s
 * `[db.seed] sql_paths` glob (`./seeds/*.sql`) sorts them lexicographically into exactly that order.
 *
 * Emit PURE SQL only. The Supabase CLI executes seed files through a Go SQL driver rather than psql,
 * so a psql meta-command such as `\ir` is a plain syntax error there — which is why the glob, and
 * not an includes file, is the mechanism.
 */

import { exploreMocks } from "../../packages/backend/mocks/mod.ts";

const { ARTICLES, BUSINESSES, FREELANCERS, PRODUCTS, PROJECTS, SERVICES, TEAMS, USERS } =
	exploreMocks;

// #region Deterministic identity
/**
 * A stable UUID for a natural key.
 *
 * FNV-1a over `${namespace}:${key}`, expanded to 128 bits and stamped with the version-4 nibbles so
 * Postgres accepts it as a `uuid`. It is deliberately NOT a real UUIDv5 — that needs SHA-1 and an
 * async Web Crypto call, and this runs thousands of times to write a file. What matters here is only
 * that it is stable, collision-free across this corpus, and syntactically a UUID.
 */
function uuidFor(namespace: string, key: string): string {
	const input = `${namespace}:${key}`;
	// Four independently-seeded FNV-1a passes give 128 bits without needing a hash library.
	const words: number[] = [];
	for (let seed = 0; seed < 4; seed++) {
		let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
		for (let i = 0; i < input.length; i++) {
			h ^= input.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		words.push(h >>> 0);
	}
	const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
	// Version 4, variant RFC-4122 — so the value is a well-formed UUID, not merely 32 hex digits.
	const v = `${hex.slice(0, 12)}4${hex.slice(13, 16)}a${hex.slice(17, 32)}`;
	return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${
		v.slice(20, 32)
	}`;
}

/** `@marisdelacroix` -> `marisdelacroix`. */
function bare(handle: string): string {
	return handle.replace(/^@/, "");
}

/** Escape a value for a single-quoted SQL literal, or emit NULL. */
function q(value: string | null | undefined): string {
	if (value === null || value === undefined) return "NULL";
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** A Postgres `text[]` literal. */
function arr(values: readonly string[]): string {
	if (!values.length) return `'{}'::text[]`;
	return `ARRAY[${values.map(q).join(", ")}]::text[]`;
}

/** Split a display name into first/last, tolerating single-word and multi-word names. */
function splitName(name: string): { first: string; last: string } {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return { first: parts[0], last: "" };
	return { first: parts[0], last: parts.slice(1).join(" ") };
}
// #endregion

// #region Corpus -> principals
interface Principal {
	handle: string;
	name: string;
	kind: string;
	verified: boolean;
	avatar?: string;
}

/**
 * Every distinct identity in the corpus, from BOTH the profile arrays and the `owner` block every
 * item carries.
 *
 * The union is the point: a service owned by `@ateliernova` must not fail its foreign key because
 * that team happens not to appear in the `TEAMS` array. Collecting owners from the items themselves
 * makes the seed self-consistent regardless of which arrays the corpus chooses to populate.
 */
function collectPrincipals(): Map<string, Principal> {
	const out = new Map<string, Principal>();
	const add = (p: Principal) => {
		if (!p?.handle) return;
		if (!out.has(p.handle)) out.set(p.handle, p);
	};

	for (const item of [...FREELANCERS, ...USERS, ...TEAMS, ...BUSINESSES]) {
		add({
			handle: item.owner.handle,
			name: item.owner.name ?? item.title,
			kind: item.owner.kind ?? item.type,
			verified: !!item.owner.verified,
			avatar: item.owner.avatar,
		});
	}
	for (const item of [...SERVICES, ...PROJECTS, ...PRODUCTS, ...ARTICLES]) {
		add({
			handle: item.owner.handle,
			name: item.owner.name,
			kind: item.owner.kind,
			verified: !!item.owner.verified,
			avatar: item.owner.avatar,
		});
	}
	return out;
}

/**
 * The human behind an entity.
 *
 * A team or business is owned by a user, and the corpus does not model that user separately — it
 * gives the entity its own handle. So each entity gets a synthetic owner account derived from its
 * handle. That is honest for a seed: the FK needs a real `auth.users` row, and inventing one
 * deterministically is better than attaching every entity to one shared account, which would make
 * every ownership query in the app return the same person.
 */
function ownerAccountFor(p: Principal): { handle: string; name: string } {
	if (p.kind === "team" || p.kind === "business" || p.kind === "organisation") {
		return { handle: `${bare(p.handle)}-owner`, name: `${p.name} Owner` };
	}
	return { handle: bare(p.handle), name: p.name };
}
// #endregion

const HEADER = (title: string, note: string) =>
	`-- =============================================================================================
-- ${title}
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- ${note}
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================

`;

const principals = collectPrincipals();

// Resolve every principal to its account + entity ids once, so later files agree with earlier ones.
interface Resolved {
	p: Principal;
	accountHandle: string;
	accountName: string;
	userId: string;
	entityId: string;
}
const resolved = new Map<string, Resolved>();
for (const [handle, p] of principals) {
	const acct = ownerAccountFor(p);
	resolved.set(handle, {
		p,
		accountHandle: acct.handle,
		accountName: acct.name,
		userId: uuidFor("user", acct.handle),
		entityId: uuidFor(p.kind, bare(handle)),
	});
}

/** Distinct user accounts (entity owners collapse to one account each). */
const accounts = new Map<string, Resolved>();
for (const r of resolved.values()) {
	if (!accounts.has(r.accountHandle)) accounts.set(r.accountHandle, r);
}

// #region 01 — identities
function fileIdentities(): string {
	const lines: string[] = [
		HEADER(
			"01_identities.sql — auth accounts, public profiles and freelancer profiles",
			"Derived from the discovery corpus in packages/backend/services/explore/fixtures.ts. Triggers are suppressed around the auth.users insert only, because the onboarding trigger assumes a live GoTrue signup.",
		),
	];

	lines.push("SET session_replication_role = replica;\n");
	lines.push(
		"-- The token columns are seeded as EMPTY STRINGS, not left NULL, and that is load-bearing.",
	);
	lines.push(
		"-- GoTrue scans confirmation_token / recovery_token / email_change* / phone_change* /",
	);
	lines.push(
		"-- reauthentication_token into non-nullable Go strings. A NULL in any of them makes every",
	);
	lines.push(
		"-- sign-in fail with a 500 'Database error querying schema' — which reads like a broken",
	);
	lines.push("-- database rather than a bad seed, and is why this is spelled out here.");
	lines.push("INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,");
	lines.push(
		"                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,",
	);
	lines.push(
		"                        confirmation_token, recovery_token, email_change, email_change_token_new,",
	);
	lines.push(
		"                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)",
	);
	lines.push("VALUES");
	const userRows = [...accounts.values()].map((r) =>
		`  ('00000000-0000-0000-0000-000000000000', '${r.userId}', 'authenticated', 'authenticated', ` +
		`${q(`${r.accountHandle}@projective.dev`)}, crypt('password123', gen_salt('bf')), ` +
		`now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', ` +
		`'', '', '', '', '', '', '', '')`
	);
	lines.push(userRows.join(",\n"));
	lines.push("ON CONFLICT (id) DO NOTHING;\n");

	lines.push(
		"INSERT INTO org.users_public (user_id, username, first_name, last_name, headline, country, timezone, languages, dob, is_freelancer, is_operator)",
	);
	lines.push("VALUES");
	const publicRows = [...accounts.values()].map((r) => {
		const { first, last } = splitName(r.accountName);
		const isFreelancer = r.p.kind === "freelancer" || r.p.kind === "team";
		const isOperator = r.p.kind === "business" || r.p.kind === "organisation";
		return `  ('${r.userId}', ${q(r.accountHandle)}, ${q(first)}, ${q(last)}, ` +
			`${q(`${r.p.name} on Projective`)}, ${q("United Kingdom")}, ${q("Europe/London")}, ` +
			`${arr(["English"])}, '1990-01-01', ${isFreelancer}, ${isOperator})`;
	});
	lines.push(publicRows.join(",\n"));
	lines.push("ON CONFLICT (user_id) DO NOTHING;\n");
	lines.push("SET session_replication_role = origin;\n");

	// Freelancer profiles for the individual sellers the corpus actually describes.
	const freelancerRows = FREELANCERS.map((f) => {
		const r = resolved.get(f.owner.handle);
		if (!r) return null;
		const skills = (f.skills ?? []).map((s) => s.label.toLowerCase());
		const load = f.workload?.level ?? 20;
		return `  ('${r.userId}', ${arr(skills)}, ${
			q(load >= 60 ? "busy" : "available")
		}, ${load}, now() - interval '7 days')`;
	}).filter(Boolean);
	if (freelancerRows.length) {
		lines.push(
			"INSERT INTO org.freelancer_profiles (user_id, skills, availability_status, current_workload_intensity, available_since)",
		);
		lines.push("VALUES");
		lines.push(freelancerRows.join(",\n"));
		lines.push("ON CONFLICT (user_id) DO NOTHING;\n");
	}
	return lines.join("\n");
}
// #endregion

// #region 02 — entities
function fileEntities(): string {
	const lines: string[] = [
		HEADER(
			"02_entities.sql — teams and businesses",
			"A team is a Freelancer with multiple members (seller side); a business is a Client with multiple members (buyer side). Each entity's owner account was seeded in 01.",
		),
	];

	const teams = [...resolved.values()].filter((r) => r.p.kind === "team");
	if (teams.length) {
		lines.push(
			"INSERT INTO org.teams (id, owner_user_id, name, slug, headline, current_workload_intensity, available_since, status)",
		);
		lines.push("VALUES");
		lines.push(
			teams.map((r) =>
				`  ('${r.entityId}', '${r.userId}', ${q(r.p.name)}, ${q(bare(r.p.handle))}, ` +
				`${
					q(`${r.p.name} — collaborative studio on Projective`)
				}, 30, now() - interval '14 days', 'active')`
			).join(",\n"),
		);
		lines.push("ON CONFLICT (id) DO NOTHING;\n");

		lines.push("INSERT INTO org.team_members (team_id, user_id, status)");
		lines.push("VALUES");
		lines.push(teams.map((r) => `  ('${r.entityId}', '${r.userId}', 'active')`).join(",\n"));
		lines.push("ON CONFLICT DO NOTHING;\n");
	}

	const businesses = [...resolved.values()].filter((r) => r.p.kind === "business");
	if (businesses.length) {
		lines.push(
			"INSERT INTO org.business_profiles (id, owner_user_id, name, slug, billing_email, headline, country, status)",
		);
		lines.push("VALUES");
		lines.push(
			businesses.map((r) =>
				`  ('${r.entityId}', '${r.userId}', ${q(r.p.name)}, ${q(bare(r.p.handle))}, ` +
				`${q(`billing@${bare(r.p.handle)}.dev`)}, ${q(`${r.p.name} — client on Projective`)}, ` +
				`${q("United Kingdom")}, 'active')`
			).join(",\n"),
		);
		lines.push("ON CONFLICT (id) DO NOTHING;\n");
	}

	return lines.join("\n");
}
// #endregion

// #region 03 — marketplace services
/** Parse a formatted price ("$4,800", "From £120 / ticket") into integer minor units. */
function priceMinorOf(item: { priceMinor?: number; price?: string; amount?: number }): number {
	if (typeof item.priceMinor === "number") return item.priceMinor;
	if (typeof item.amount === "number") return Math.round(item.amount * 100);
	const digits = String(item.price ?? "").replace(/[^0-9.]/g, "");
	const n = Number(digits);
	return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function fileMarketplace(): string {
	const lines: string[] = [
		HEADER(
			"03_marketplace.sql — service blueprints",
			"marketplace.service_blueprints owns HOW a service is delivered and priced. Its publication (draft/published, gallery, taxonomy) is catalogue.listings, seeded in 04.",
		),
	];

	// A blueprint's FK targets org.freelancer_profiles(user_id), so only individual sellers with a
	// freelancer profile can carry one. Team-owned services are seeded against the team's owner
	// account, which does have one.
	const freelancerUserIds = new Set(
		FREELANCERS.map((f) => resolved.get(f.owner.handle)?.userId).filter(Boolean) as string[],
	);

	const rows = SERVICES.map((s) => {
		const r = resolved.get(s.owner.handle);
		if (!r || !freelancerUserIds.has(r.userId)) return null;
		const id = uuidFor("service", s.id);
		return `  ('${id}', '${r.userId}', ${q(s.title)}, '{}'::jsonb, ${q(s.summary)}, ` +
			`'flat_fee', ${priceMinorOf(s)}, 'USD', true, 1, false, '{}'::jsonb, true)`;
	}).filter(Boolean);

	if (rows.length) {
		lines.push(
			"INSERT INTO marketplace.service_blueprints (id, freelancer_profile_id, title, description, description_text,",
		);
		lines.push(
			"    pricing_model, price_cents, currency, requires_upfront_escrow, max_seats_per_cohort,",
		);
		lines.push("    allow_continuous_enrollment, session_template_rules, is_published)");
		lines.push("VALUES");
		lines.push(rows.join(",\n"));
		lines.push("ON CONFLICT (id) DO NOTHING;\n");
	} else {
		lines.push("-- No corpus service resolved to a seeded freelancer profile.\n");
	}
	return lines.join("\n");
}
// #endregion

// #region 04 — catalogue
function fileCatalogue(): string {
	const lines: string[] = [
		HEADER(
			"04_catalogue.sql — products, articles and the seller listings over them",
			"catalogue owns the PUBLICATION layer. A listing points at its subject (a service blueprint or a product) rather than restating its price, so the two cannot disagree.",
		),
	];

	// Products.
	const productRows = PRODUCTS.map((p) => {
		const r = resolved.get(p.owner.handle);
		if (!r) return null;
		const id = uuidFor("product", p.id);
		return `  ('${id}', '${r.userId}', ${q(p.title)}, '{}'::jsonb, ${q(p.summary)}, ` +
			`'download', ${q(p.category ?? "")}, ${priceMinorOf(p)}, ${q(p.currency ?? "USD")}, ` +
			`'standard', false, ${p.span ?? 1})`;
	}).filter(Boolean);
	if (productRows.length) {
		lines.push(
			"INSERT INTO catalogue.products (id, owner_user_id, title, description, description_text,",
		);
		lines.push("    format, category, price_cents, currency, licence, attribution_required, span)");
		lines.push("VALUES");
		lines.push(productRows.join(",\n"));
		lines.push("ON CONFLICT (id) DO NOTHING;\n");
	}

	// Articles.
	const articleRows = ARTICLES.map((a) => {
		const r = resolved.get(a.owner.handle);
		if (!r) return null;
		const id = uuidFor("article", a.id);
		return `  ('${id}', '${r.userId}', ${q(a.id)}, ${q(a.title)}, ${q(a.topic ?? "")}, ` +
			`${q(a.summary)}, '[]'::jsonb, ${q(a.summary)}, ${
				Math.max(1, Math.round(a.readMinutes ?? 1))
			}, ` +
			`'published', now() - interval '30 days')`;
	}).filter(Boolean);
	if (articleRows.length) {
		lines.push(
			"INSERT INTO catalogue.articles (id, owner_user_id, slug, title, topic, summary, body, body_text, read_minutes, status, published_at)",
		);
		lines.push("VALUES");
		lines.push(articleRows.join(",\n"));
		lines.push("ON CONFLICT (id) DO NOTHING;\n");
	}

	// Listings over the products (the service listings need their blueprint, seeded in 03; only
	// blueprints that actually landed are referenced, so the FK cannot dangle).
	const listingRows = PRODUCTS.map((p) => {
		const r = resolved.get(p.owner.handle);
		if (!r) return null;
		const productId = uuidFor("product", p.id);
		const id = uuidFor("listing", p.id);
		return `  ('${id}', '${r.userId}', 'product', 'published', NULL, '${productId}', ` +
			`${q(p.title)}, '{}'::jsonb, ${q(p.summary)}, ${q(p.category ?? "")}, 'Instant download', ` +
			`${priceMinorOf(p)}, ${q(p.currency ?? "USD")}, ${!!p
				.sponsored}, now() - interval '20 days')`;
	}).filter(Boolean);
	if (listingRows.length) {
		lines.push(
			"INSERT INTO catalogue.listings (id, owner_user_id, kind, status, service_blueprint_id, product_id,",
		);
		lines.push(
			"    title, description, description_text, category, delivery_label, amount_cents, currency, promoted, published_at)",
		);
		lines.push("VALUES");
		lines.push(listingRows.join(",\n"));
		lines.push("ON CONFLICT (id) DO NOTHING;\n");

		// Cover media, position 0.
		const mediaRows = PRODUCTS.map((p) => {
			if (!p.media) return null;
			const listingId = uuidFor("listing", p.id);
			return `  ('${uuidFor("media", p.id)}', '${listingId}', NULL, ${q(p.media)}, ${
				q(p.title)
			}, 0)`;
		}).filter(Boolean);
		if (mediaRows.length) {
			lines.push(
				"INSERT INTO catalogue.listing_media (id, listing_id, file_id, url, alt_text, position)",
			);
			lines.push("VALUES");
			lines.push(mediaRows.join(",\n"));
			// The arbiter is named explicitly. A bare `ON CONFLICT DO NOTHING` asks Postgres to infer
			// one from every unique constraint on the table, and `uq_listing_media_position` is
			// DEFERRABLE — which a conflict arbiter may not be. That constraint is deferrable on
			// purpose (reordering a gallery swaps positions inside one transaction), so the fix belongs
			// here rather than in the schema.
			lines.push("ON CONFLICT (id) DO NOTHING;\n");
		}
	}

	return lines.join("\n");
}
// #endregion

// #region 05 — projects
function fileProjects(): string {
	const lines: string[] = [
		HEADER(
			"05_projects.sql — open projects and their stages",
			"client_business_id is set on every row deliberately: projects.update_entity_project_counts() dereferences a team_id column that does not exist on projects.projects whenever client_business_id IS NULL, which errors on a user-owned project. That is a pre-existing trigger bug, worked around here rather than fixed silently.",
		),
	];

	const businesses = [...resolved.values()].filter((r) => r.p.kind === "business");
	if (!businesses.length) {
		lines.push("-- No business in the corpus to attribute projects to; skipping.\n");
		return lines.join("\n");
	}

	const rows = PROJECTS.map((p, i) => {
		const r = resolved.get(p.owner.handle);
		if (!r) return null;
		const client = businesses[i % businesses.length];
		const id = uuidFor("project", p.id);
		// Both derived from the classification, never hardcoded: every seeded project carries stages,
		// so a pipeline is `standard` and a one-off is `one_off` (the `createFormatToColumns` mapping in
		// `@projective/types/projects/setup`). And a deadline bonus is a per-ticket incentive, so
		// `ck_projects_deadline_bonus_format` refuses it on any non-pipeline format — a flat `true` here
		// aborted the whole seed batch on the first one-off row.
		const pipeline = p.classification === "pipeline";
		const format = pipeline ? "pipeline" : "one_off";
		const structure = pipeline ? "standard" : "one_off";
		return `  ('${id}', '${client.entityId}', '${r.userId}', ${q(p.title)}, '{}'::jsonb, ${
			q(p.summary)
		}, ` +
			`${q(format)}, ${
				q(structure)
			}, 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', ` +
			`false, 'allowed', ${pipeline}, ${arr(["Remote"])}, ${
				arr(["English"])
			}, now() + interval '21 days')`;
	}).filter(Boolean);

	if (rows.length) {
		lines.push(
			"INSERT INTO projects.projects (id, client_business_id, owner_user_id, title, description, description_text,",
		);
		lines.push(
			"    format, structure_variation, status, visibility, currency, timeline_preset, ip_ownership_mode,",
		);
		lines.push(
			"    nda_required, portfolio_display_rights, allow_deadline_bonuses, location_restriction, language_requirement, target_project_start_date)",
		);
		lines.push("VALUES");
		lines.push(rows.join(",\n"));
		lines.push("ON CONFLICT (id) DO NOTHING;\n");

		const stageRows: string[] = [];
		for (const p of PROJECTS) {
			const phases: string[] = (p as { phases?: string[] }).phases ?? ["Discovery", "Delivery"];
			phases.slice(0, 4).forEach((phase, idx) => {
				stageRows.push(
					`  ('${uuidFor("stage", `${p.id}:${idx}`)}', '${uuidFor("project", p.id)}', ${
						q(phase)
					}, ` +
						`${q(`${phase} for ${p.title}`)}, ${idx + 1}, 'open', ${arr([])}, ${
							100000 * (idx + 1)
						})`,
				);
			});
		}
		if (stageRows.length) {
			lines.push(
				"INSERT INTO projects.project_stages (id, project_id, name, description_text, sort_order, status, skills, unit_price_cents)",
			);
			lines.push("VALUES");
			lines.push(stageRows.join(",\n"));
			lines.push("ON CONFLICT (id) DO NOTHING;\n");
		}
	}
	return lines.join("\n");
}
// #endregion

// #region Write
const files: Array<[string, string]> = [
	["01_identities.sql", fileIdentities()],
	["02_entities.sql", fileEntities()],
	["03_marketplace.sql", fileMarketplace()],
	["04_catalogue.sql", fileCatalogue()],
	["05_projects.sql", fileProjects()],
];

const dir = new URL(".", import.meta.url);
for (const [name, body] of files) {
	await Deno.writeTextFile(new URL(name, dir), body.replace(/\r\n/g, "\n"));
	console.log(`wrote supabase/seeds/${name} (${body.split("\n").length} lines)`);
}
console.log(
	`\nprincipals=${principals.size} accounts=${accounts.size} services=${SERVICES.length} ` +
		`products=${PRODUCTS.length} articles=${ARTICLES.length} projects=${PROJECTS.length}`,
);
// #endregion
