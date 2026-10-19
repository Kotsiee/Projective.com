/**
 * The contract between the workspace permission engine's two implementations — the TypeScript SSOT
 * (`common.ts`: `capabilitiesForKind`, `presetCapabilities`, `roleRank`) and its SQL twin in
 * `00001020_functions_org_entities.sql` §6/§9 (`org.fn_kind_capabilities`, `org.fn_preset_capabilities`,
 * `org.fn_preset_rank`, `org.fn_is_reserved_handle`), plus the `org.workspace_capability` enum itself,
 * and the handle claim rule (`workspace.ts` `localHandleRefusal` ↔ `org.fn_handle_refusal`).
 *
 * Every write RPC gates on the SQL twin while every screen renders from the TypeScript, so a list that
 * moves on one side alone makes the console offer an action the database refuses (or hide one it would
 * allow). The two cannot be compared by a type-checker; this test compares the FILE CONTENT (the
 * `hired-teams.contract.test.ts` technique), so it fails with no database.
 *
 * It is also the handle namespace guard (Teams P1): every top-level segment `apps/web/routes/` serves
 * must be a reserved handle, so a person or a team can never claim `@saved` and shadow `/saved`.
 */
import { assert, assertEquals } from "@std/assert";
import {
	capabilitiesForKind,
	kindCopy,
	presetCapabilities,
	roleRank,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceRole,
} from "./common.ts";
import { RESERVED_HANDLES } from "../profile/reserved.ts";
import { EntitlementKey } from "../finance/entitlements.ts";
import { SplitRuleType } from "../finance/vault.ts";
import {
	BusinessViewerCanSchema,
	KybRequirement,
	PayoutPreviewQuerySchema,
	SpendLimitSchema,
	SplitRuleInputSchema,
	TeamPayoutPolicySchema,
} from "./policy.ts";
import {
	ArchiveBlockerSchema,
	BusinessArchiveBlockerCode,
	CreateWorkspaceInputSchema,
	HANDLE_REFUSALS,
	handleAlternatives,
	HandleRefusalCode,
	handleRefusalOf,
	localHandleRefusal,
	RESTORE_TARGET_REASON,
	RestoreTarget,
	TeamArchiveBlockerCode,
	TeamEngagementSchema,
	UpdatePayoutInputSchema,
	UpdateSpendInputSchema,
	walletHrefFor,
	WORKSPACE_HANDLE_MAX,
	WORKSPACE_HANDLE_MIN,
	WORKSPACE_HANDLE_PATTERN,
	WORKSPACE_NAME_MAX,
	WORKSPACE_NAME_MIN,
	WorkspaceDetailSchema,
	WorkspaceStatusChange,
} from "./workspace.ts";

// #region Reading the SQL

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

const ENTITIES_SQL = "supabase/migrations/00001020_functions_org_entities.sql";
const ENUMS_SQL = "supabase/migrations/00000004_enums_domains.sql";

/** The body of one `CREATE OR REPLACE FUNCTION <name>(` … `$$;` block. */
function functionBody(sql: string, name: string): string {
	const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is no longer defined`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, `${name} has no terminating $$;`);
	return sql.slice(start, end);
}

/** Every single-quoted literal in a fragment, in order. */
function literals(fragment: string): string[] {
	return [...fragment.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** The members of `org.workspace_capability`, in declaration order (comments stripped). */
function capabilityEnum(): string[] {
	const sql = read(ENUMS_SQL);
	const start = sql.indexOf("CREATE TYPE org.workspace_capability AS ENUM (");
	assert(
		start >= 0,
		"org.workspace_capability is no longer declared in 00000004_enums_domains.sql",
	);
	const end = sql.indexOf(");", start);
	const block = sql.slice(start, end).split("\n").map((line) => line.replace(/--.*$/, "")).join(
		"\n",
	);
	return literals(block);
}

const entities = read(ENTITIES_SQL);
const kindBody = functionBody(entities, "org.fn_kind_capabilities");
const presetBody = functionBody(entities, "org.fn_preset_capabilities");
const rankBody = functionBody(entities, "org.fn_preset_rank");
const reservedBody = functionBody(entities, "org.fn_is_reserved_handle");

/** The capabilities `org.fn_kind_capabilities` excludes for a kind. */
function excludedFor(kind: string): string[] {
	const match = new RegExp(`WHEN '${kind}' THEN e\\.c NOT IN \\(([^)]*)\\)`).exec(kindBody);
	assert(match, `org.fn_kind_capabilities has no NOT IN branch for '${kind}'`);
	return literals(match[1]);
}

/** The raw capability bundle `org.fn_preset_capabilities` lists for a preset (`owner` = every member). */
function presetArray(role: string, all: readonly string[]): string[] {
	if (role === "owner") {
		assert(
			/WHEN 'owner' THEN enum_range\(NULL::org\.workspace_capability\)/.test(presetBody),
			"the owner preset no longer grants the whole enum",
		);
		return [...all];
	}
	const match = new RegExp(`WHEN '${role}' THEN ARRAY\\[([^\\]]*)\\]`).exec(presetBody);
	assert(match, `org.fn_preset_capabilities has no ARRAY for '${role}'`);
	return literals(match[1]);
}

/** Sort a capability list into enum order — the order every SQL twin returns and the SSOT filters in. */
function inEnumOrder(list: readonly string[], all: readonly string[]): string[] {
	return all.filter((c) => list.includes(c));
}

// #endregion

// #region Tests

Deno.test("org.workspace_capability declares WorkspaceCapability.options, in order", () => {
	assertEquals(capabilityEnum(), [...WorkspaceCapability.options]);
});

Deno.test("org.fn_kind_capabilities filters exactly as capabilitiesForKind does, for both kinds", () => {
	const all = capabilityEnum();
	for (const kind of WorkspaceKind.options) {
		const excluded = excludedFor(kind);
		for (const cap of excluded) {
			assert(all.includes(cap), `'${cap}' excluded for ${kind} is not a capability`);
		}
		assertEquals(
			all.filter((c) => !excluded.includes(c)),
			capabilitiesForKind(kind),
			`kind ${kind}`,
		);
	}
});

Deno.test("org.fn_preset_capabilities carries the SSOT's preset bundles — owner = every capability", () => {
	const all = capabilityEnum();
	const branches = [...presetBody.matchAll(/WHEN '(\w+)' THEN/g)].map((m) => m[1]).sort();
	assertEquals(
		branches,
		[...WorkspaceRole.options].sort(),
		"the preset CASE names a different set of presets",
	);
	for (const role of WorkspaceRole.options) {
		const raw = presetArray(role, all);
		for (const cap of raw) {
			assert(all.includes(cap), `'${cap}' in the ${role} preset is not a capability`);
		}
		// The raw ARRAY is the preset's whole bundle: the union of what each kind renders of it.
		const union = inEnumOrder(
			WorkspaceKind.options.flatMap((kind) => presetCapabilities(role, kind)),
			all,
		);
		assertEquals(inEnumOrder(raw, all), union, `raw ${role} bundle`);
		// And kind-scoped, exactly as the SQL intersects it with fn_kind_capabilities.
		for (const kind of WorkspaceKind.options) {
			const kindCaps = capabilitiesForKind(kind) as string[];
			assertEquals(
				inEnumOrder(raw.filter((c) => kindCaps.includes(c)), all),
				presetCapabilities(role, kind),
				`${role} on a ${kind}`,
			);
		}
	}
});

Deno.test("org.fn_preset_rank ranks the presets exactly as roleRank does", () => {
	const ranks = new Map(
		[...rankBody.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]),
	);
	assertEquals([...ranks.keys()].sort(), [...WorkspaceRole.options].sort());
	for (const role of WorkspaceRole.options) {
		assertEquals(ranks.get(role), roleRank(role), `rank of ${role}`);
	}
	assert(/ELSE 0 END/.test(rankBody), "an unknown preset must rank below every real one");
});

Deno.test("org.fn_is_reserved_handle reserves exactly RESERVED_HANDLES", () => {
	const start = reservedBody.indexOf("ARRAY[");
	assert(start >= 0, "org.fn_is_reserved_handle no longer lists its handles in an ARRAY");
	const list = literals(reservedBody.slice(start, reservedBody.indexOf("]", start)));
	assertEquals(new Set(list), new Set(RESERVED_HANDLES));
	assertEquals(list.length, new Set(list).size, "the SQL list repeats a handle");
});

Deno.test("org.fn_handle_refusal judges a handle by the TS claim rule, branch for branch, in order", () => {
	const body = functionBody(entities, "org.fn_handle_refusal");
	const branches: Array<[HandleRefusalCode, string]> = [
		["short", `length(p_handle) < ${WORKSPACE_HANDLE_MIN} THEN '${HANDLE_REFUSALS.short}'`],
		["long", `length(p_handle) > ${WORKSPACE_HANDLE_MAX} THEN '${HANDLE_REFUSALS.long}'`],
		[
			"format",
			`p_handle !~ '${WORKSPACE_HANDLE_PATTERN.source}' THEN '${HANDLE_REFUSALS.format}'`,
		],
		["reserved", `org.fn_is_reserved_handle(p_handle) THEN '${HANDLE_REFUSALS.reserved}'`],
		["taken", `org.fn_handle_taken(p_handle) THEN '${HANDLE_REFUSALS.taken}'`],
	];
	let from = 0;
	for (const [code, branch] of branches) {
		const at = body.indexOf(branch, from);
		assert(at >= 0, `fn_handle_refusal's ${code} branch no longer reads: ${branch}`);
		from = at + branch.length;
	}
	assertEquals(
		branches.map(([code]) => code),
		[...HandleRefusalCode.options],
		"HandleRefusalCode must list the branches in the database's order",
	);
});

Deno.test("localHandleRefusal answers the local branches; CreateWorkspaceInputSchema agrees", () => {
	const cases: Array<[string, HandleRefusalCode | null]> = [
		["ab", "short"],
		["a".repeat(WORKSPACE_HANDLE_MAX + 1), "long"],
		["-studio", "format"],
		["studio-", "format"],
		["Studio", "format"],
		["stu_dio", "format"],
		["teams", "reserved"],
		["create", "reserved"],
		["northern-grid", null],
		["a".repeat(WORKSPACE_HANDLE_MAX), null],
	];
	for (const [handle, code] of cases) {
		assertEquals(localHandleRefusal(handle), code, handle);
		const parsed = CreateWorkspaceInputSchema.safeParse({ kind: "team", name: "Grid", handle });
		// A reserved word is well-formed: only the database (and the probe) refuses it.
		assertEquals(parsed.success, code === null || code === "reserved", `schema on ${handle}`);
	}
	for (const code of HandleRefusalCode.options) {
		assertEquals(handleRefusalOf(HANDLE_REFUSALS[code]), code);
	}
	assertEquals(handleRefusalOf(null), null);
	assertEquals(handleRefusalOf("Something the client never heard of."), "taken");
});

Deno.test("org.create_workspace bounds a name exactly as CreateWorkspaceInputSchema does", () => {
	const body = functionBody(entities, "org.create_workspace");
	assert(
		body.includes(
			`length(v_name) < ${WORKSPACE_NAME_MIN} OR length(v_name) > ${WORKSPACE_NAME_MAX}`,
		),
		"create_workspace's name bounds moved away from WORKSPACE_NAME_MIN / WORKSPACE_NAME_MAX",
	);
});

Deno.test("org.create_workspace words its plan cap in the kind's own noun and plural (kindCopy)", () => {
	const body = functionBody(entities, "org.create_workspace");
	for (const kind of WorkspaceKind.options) {
		const { noun, plural } = kindCopy(kind);
		assert(
			body.includes(`WHEN v_limit = 1 THEN '${noun}' ELSE '${plural}' END`),
			`create_workspace's plan refusal no longer says "1 ${noun}" / "N ${plural}"`,
		);
	}
});

Deno.test("handleAlternatives: well-formed, distinct, within the length cap, never the original", () => {
	const long = "a".repeat(WORKSPACE_HANDLE_MAX);
	for (const handle of ["northern-grid", "abc", long, `${"b".repeat(37)}-cd`]) {
		const out = handleAlternatives(handle);
		assert(out.length >= 3, `${handle} offers too few candidates`);
		assertEquals(out.length, new Set(out).size, `${handle} repeats a candidate`);
		for (const candidate of out) {
			assertEquals(localHandleRefusal(candidate), null, candidate);
			assert(candidate !== handle, `${handle} offered itself`);
		}
	}
	assertEquals(handleAlternatives("northern-grid").slice(0, 3), [
		"northern-grid-hq",
		"northern-grid-co",
		"northern-grid-2",
	]);
});

// #region The handle namespace guard (Teams P1)

const ROUTES = new URL("apps/web/routes/", REPO);

/** A file beside the routes that is not a route module: a test, a spec or a type declaration. */
const NOT_A_ROUTE = /\.(test|spec|d)\.(tsx|ts|jsx|js)$/;

/**
 * The URL segment one entry of a routes directory claims, or `null` for an entry that claims none:
 * a `_`-prefixed file (`_app`, `_layout`, `_middleware`), a `[param]`, an `index`, a file that is
 * not a module at all, or one that is not a route module ({@link NOT_A_ROUTE}). A dotted route
 * module claims its whole stem — `feed.xml.ts` serves `/feed.xml`, as `robots.txt` and `sitemap.xml`
 * are reserved. A route group `(…)` is descended by the caller, since it adds no segment of its own.
 */
function routeSegment(name: string, isDirectory: boolean): string | null {
	if (name.startsWith("_") || name.startsWith(".") || name.startsWith("[")) return null;
	if (isDirectory) return name;
	if (NOT_A_ROUTE.test(name)) return null;
	const match = /^(.+)\.(tsx|ts|jsx|js)$/.exec(name);
	if (!match) return null;
	return match[1] === "index" ? null : match[1];
}

/** Every top-level URL segment the routes tree serves — route groups are URL-transparent. */
function topLevelSegments(dir: URL): string[] {
	const out: string[] = [];
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isDirectory && /^\(.+\)$/.test(entry.name)) {
			out.push(...topLevelSegments(new URL(`${entry.name}/`, dir)));
			continue;
		}
		const segment = routeSegment(entry.name, entry.isDirectory);
		if (segment) out.push(segment);
	}
	return out;
}

Deno.test("a routes entry claims its segment: groups, params, _files, index and tests claim none", () => {
	assertEquals(routeSegment("saved", true), "saved");
	assertEquals(routeSegment("explore.tsx", false), "explore");
	assertEquals(routeSegment("feed.xml.ts", false), "feed.xml");
	assertEquals(routeSegment("robots.txt.tsx", false), "robots.txt");
	for (const name of ["_app.tsx", "_layout.tsx", "[handle]", "index.tsx", "readme.md"]) {
		assertEquals(routeSegment(name, name === "[handle]"), null, name);
	}
	for (const name of ["explore.test.ts", "explore.spec.tsx", "routes.d.ts"]) {
		assertEquals(routeSegment(name, false), null, name);
	}
});

Deno.test("every top-level route segment is a reserved handle, so no @handle can shadow a page", () => {
	const segments = [...new Set(topLevelSegments(ROUTES))].sort();
	assert(
		segments.includes("teams") && segments.includes("explore") && segments.includes("api"),
		"the routes tree was not read through its groups",
	);
	const missing = segments.filter((segment) => !RESERVED_HANDLES.has(segment));
	assertEquals(
		missing,
		[],
		`reserve ${
			missing.join(", ")
		} in RESERVED_HANDLES AND org.fn_is_reserved_handle in the same change`,
	);
});

// #endregion

Deno.test("finance.split_rule_type declares SplitRuleType.options, and the template input covers each", () => {
	const sql = read(ENUMS_SQL);
	const match = /CREATE TYPE finance\.split_rule_type AS ENUM \(([^)]*)\)/.exec(sql);
	assert(match, "finance.split_rule_type is no longer declared in 00000004_enums_domains.sql");
	assertEquals(literals(match[1]), [...SplitRuleType.options]);
	const covered = SplitRuleInputSchema.options.map((o) => o.shape.ruleType.value);
	assertEquals([...covered].sort(), [...SplitRuleType.options].sort());
	// finance.save_split_rule gates each template on `split_template_<type>`, in SQL and in the SSOT.
	const keyBlock = /CREATE TYPE finance\.entitlement_key AS ENUM \(([\s\S]*?)\);/.exec(sql);
	assert(keyBlock, "finance.entitlement_key is no longer declared in 00000004_enums_domains.sql");
	const sqlKeys = literals(keyBlock[1].replace(/--.*$/gm, ""));
	assertEquals(sqlKeys, [...EntitlementKey.options]);
	for (const type of SplitRuleType.options) {
		assert(
			(EntitlementKey.options as readonly string[]).includes(`split_template_${type}`),
			`no split_template_${type} entitlement key`,
		);
	}
});

Deno.test("UpdatePayoutInputSchema: a template, stakes, or both — never neither", () => {
	const stakes = [{ memberId: "m1", shareBp: 10_000 }];
	assert(UpdatePayoutInputSchema.safeParse({ workspaceId: "t", stakes }).success);
	assert(
		UpdatePayoutInputSchema.safeParse({
			workspaceId: "t",
			rule: { ruleType: "finders_fee", vaultBp: 1000, finderUserId: "u1", finderBp: 500 },
		}).success,
	);
	assert(
		UpdatePayoutInputSchema.safeParse({
			workspaceId: "t",
			rule: { ruleType: "benevolent_dictator" },
			stakes,
		}).success,
	);
	assert(!UpdatePayoutInputSchema.safeParse({ workspaceId: "t" }).success, "neither");
	assert(
		!UpdatePayoutInputSchema.safeParse({
			workspaceId: "t",
			rule: { ruleType: "finders_fee", vaultBp: 1000, finderBp: 500 },
		}).success,
		"a finder's fee without a finder",
	);
	assert(
		!UpdatePayoutInputSchema.safeParse({
			workspaceId: "t",
			rule: { ruleType: "finders_fee", vaultBp: 1000, finderUserId: "u1", finderBp: 0 },
		}).success,
		"a finder's cut of 0",
	);
	assert(
		!UpdatePayoutInputSchema.safeParse({
			workspaceId: "t",
			rule: { ruleType: "co_op", vaultBp: 10_001 },
		}).success,
		"a vault cut above 100%",
	);
	assert(
		!UpdatePayoutInputSchema.safeParse({ workspaceId: "t", rule: { ruleType: "by_role" } }).success,
		"an unknown template",
	);
});

// #endregion

// #region The one console read (Decision #233)

const detailBody = functionBody(entities, "org.get_workspace_detail");

Deno.test("org.get_workspace_detail answers every key the service maps — and no stored team W_i", () => {
	for (
		const key of [
			"'wi'",
			"'wi_cap'",
			"'share_bp'",
			"'share_held'",
			"'client'",
			"'provider_user_ids'",
			"'provider_teams'",
			"'engagements'",
			"'project_slug'",
			"'stage_slug'",
			"'stage_wi'",
			"'stage_cap'",
			"'assignees'",
			"'payout'",
			"'rule'",
			"'wallet'",
			"'available_minor'",
			"'pending_minor'",
			"'preview'",
			"'unlocked_templates'",
			"'vault_capabilities'",
			"'allowance'",
		]
	) {
		assert(detailBody.includes(key), `get_workspace_detail no longer answers ${key}`);
	}
	assert(
		/'unlocked_templates'[\s\S]*?finance\.fn_has_entitlement\('team', v_e\.id,\s*\('split_template_' \|\| /
			.test(detailBody),
		"the unlocked templates must be the split_template_<type> flags save_split_rule gates on",
	);
	assert(
		/'vault_capabilities'[\s\S]*?org\.fn_vault_capabilities_for\('team', v_e\.id, m\.user_id\)/
			.test(detailBody),
		"the vault readout must be the projection itself",
	);
	assert(
		/'payout', CASE WHEN p_kind = 'team' AND 'manage_finances' = ANY \(v_caps\)/.test(detailBody),
		"the payout block must be gated on manage_finances",
	);
	assert(
		detailBody.includes("finance.get_proposal_allowance(v_e.id)"),
		"the allowance must be get_proposal_allowance's own answer",
	);
	assert(/\bVOLATILE\b/.test(detailBody), "the allowance read writes, so the detail is VOLATILE");
	assert(!detailBody.includes("current_workload_intensity"), "W_i is summed live, never stored");
});

Deno.test("WorkspaceDetailSchema: engagements are slug-addressed; a business defaults to none", () => {
	const engagement = {
		projectSlug: "prj-abc123",
		title: "Atlas",
		stageSlug: "stg-def456",
		stageTitle: "Build",
		assignmentStatus: "accepted",
		projectStatus: "active",
		assignees: [{
			handle: "ana",
			displayName: "Ana",
			avatarUrl: "",
			wi: 2.5,
			wiCap: 10,
			stageWi: 2.5,
		}],
		stageWi: 2.5,
		stageCap: null,
	};
	assert(TeamEngagementSchema.safeParse(engagement).success);
	assert(
		!TeamEngagementSchema.safeParse({
			...engagement,
			projectSlug: "3f1c2a9e-0000-4000-8000-000000000000",
		}).success,
		"a uuid never addresses a project",
	);
	assert(
		!TeamEngagementSchema.safeParse({ ...engagement, projectStatus: "completed" }).success,
		"a completed project is not a live engagement",
	);
	const shape = WorkspaceDetailSchema.shape;
	assertEquals(shape.engagements.parse(undefined), []);
	assertEquals(shape.allowance.parse(undefined), null);
});

// #endregion

// #region The business console read (BB9)

const WALLET_SQL = "supabase/migrations/00001210_functions_finance_kyc_wallet.sql";
const wallet = read(WALLET_SQL);

/** camelCase → the snake_case key the definer answers. */
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

Deno.test("org.get_workspace_detail answers every viewerCan flag BusinessViewerCanSchema declares", () => {
	const start = detailBody.indexOf("'viewer_can'");
	assert(start >= 0, "get_workspace_detail no longer answers 'viewer_can'");
	const block = detailBody.slice(start, detailBody.indexOf("'kyb'", start));
	assert(block.length > 0, "'viewer_can' must precede 'kyb'");
	const answered = new Set(
		[...block.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]).filter((k) => k !== "viewer_can"),
	);
	assertEquals(
		[...answered].sort(),
		Object.keys(BusinessViewerCanSchema.shape).map(snake).sort(),
		"the SQL flags and the schema's must be the same set",
	);
});

Deno.test("the detail's envelopes and the preview's come from ONE helper, so a draft cannot drift", () => {
	assert(
		detailBody.includes("finance.fn_business_envelopes("),
		"get_workspace_detail must read its limits from finance.fn_business_envelopes",
	);
	const preview = functionBody(wallet, "finance.preview_spend_envelope");
	assert(
		preview.includes("finance.fn_business_envelopes("),
		"preview_spend_envelope must answer from finance.fn_business_envelopes",
	);
	assert(/\bSTABLE\b/.test(preview), "the preview writes nothing, so it is STABLE");
	assert(
		preview.includes("'manage_finances'"),
		"only a policy manager may preview a draft policy",
	);
	const helper = functionBody(wallet, "finance.fn_business_envelopes");
	for (const key of Object.keys(SpendLimitSchema.shape)) {
		// Faces and server-formatted MoneyViews are resolved by the service, not the definer.
		if (
			["handle", "name", "avatar", "limit", "spent", "remaining", "perTransaction", "memberId"]
				.includes(key)
		) continue;
		assert(
			helper.includes(`'${snake(key)}'`),
			`fn_business_envelopes no longer answers '${snake(key)}'`,
		);
	}
	assert(
		helper.includes("finance.fn_reads_wallet_envelopes("),
		"a viewer who may not read the wallet's envelopes sees only their own (BB6)",
	);
});

Deno.test("org.get_workspace_detail answers the business blocks the console maps", () => {
	for (
		const key of [
			"'spend'",
			"'approvals'",
			"'decided'",
			"'approver_user_ids'",
			"'contributor_user_ids'",
			"'platform_threshold_minor'",
			"'money_tiles'",
			"'awaiting_approval_minor'",
			"'spent_30d_minor'",
			"'committed_minor'",
			"'kyb'",
			"'requirements_due'",
			"'archive_blockers'",
			// The Spend editor's flags and each request's ref (BU2, Decision #246).
			"'editable_member_ids'",
			"'approver_gap'",
			"'limits_plan_gated'",
			"'ref_table'",
			"'consumed'",
			"finance.fn_spend_ref(",
		]
	) {
		assert(detailBody.includes(key), `get_workspace_detail no longer answers ${key}`);
	}
	for (const code of KybRequirement.options) {
		assert(
			detailBody.includes(`'${code}'`),
			`get_workspace_detail never answers KYB requirement '${code}'`,
		);
	}
});

Deno.test("a draft period is read by the save, the preview and the envelope helper alike", () => {
	// The expression each one reads the DRAFT's period with — not the output key `'period'`, which
	// the envelope helper answered before it read any draft.
	for (
		const [name, reads] of [
			["finance.save_spend_policy", "l ? 'period'"],
			["finance.preview_spend_envelope", "l ? 'period'"],
			["finance.fn_business_envelopes", "p.l->>'period'"],
		]
	) {
		assert(functionBody(wallet, name).includes(reads), `${name} no longer reads a draft period`);
	}
});

Deno.test("the Spend editor's disabled states mirror rules save_spend_policy still states (#246 (h))", () => {
	const save = functionBody(wallet, "finance.save_spend_policy");
	// `grantView` and the can-spend toggle read `viewer.capabilities` — the detail's
	// org.fn_member_capabilities, the very set the save checks a grant against (`v_actor`).
	assert(save.includes("v_actor := org.fn_member_capabilities('business', p_business_id, v_uid)"));
	assert(save.includes("IF v_want AND NOT (v_cap = ANY (v_actor))"), "grant-what-you-hold (sets)");
	assert(save.includes("IF v_want AND NOT ('spend_funds' = ANY (v_actor))"), "can-spend toggle");
	assert(
		functionBody(entities, "org.get_workspace_detail").includes("'capabilities', to_jsonb(v_caps)"),
	);
	// SpendLimitRow's plan locks: typing a ceiling where none is stored SETS one (Business Pro), and so
	// does moving the window of a row that keeps one; clearing either never is.
	assert(save.includes("(l ? 'limit_minor' AND v_limit IS NOT NULL)"), "cap lock");
	assert(
		save.includes("(l ? 'per_transaction_minor' AND v_per_tx IS NOT NULL)"),
		"per-purchase lock",
	);
	assert(
		save.includes("v_period IS DISTINCT FROM COALESCE(v_stored_period, 'monthly')"),
		"period lock",
	);
});

Deno.test("UpdateSpendInputSchema: a limits entry is a patch — any one key, never none", () => {
	const entry = (extra: Record<string, unknown>) =>
		UpdateSpendInputSchema.safeParse({ workspaceId: "b", limits: [{ memberId: "m", ...extra }] });
	assert(entry({ canSpend: true }).success);
	assert(entry({ period: "weekly" }).success);
	assert(entry({ limitMinor: null }).success);
	assert(!entry({}).success, "an entry that changes nothing is refused");
	assert(!entry({ period: "daily" }).success);
	const parsed = UpdateSpendInputSchema.parse({
		workspaceId: "b",
		limits: [{ memberId: "m", canSpend: false }],
	});
	assertEquals(parsed.limits, [{ memberId: "m", canSpend: false }], "no key is defaulted in");
});

Deno.test("UpdateSpendInputSchema: a figure past what JSON carries exactly is a field error, not a 500", () => {
	// Zod 4's `.int()` admits safe integers only, so nothing the database's bigint cast could overflow
	// (or that JSON would round) reaches `save_spend_policy`: it is a field-keyed 422 at the route.
	const over = Number.MAX_SAFE_INTEGER + 1;
	const keyOf = (input: Record<string, unknown>) => {
		const parsed = UpdateSpendInputSchema.safeParse({ workspaceId: "b", ...input });
		return parsed.success ? null : [...new Set(parsed.error.issues.map((i) => i.path.join(".")))];
	};
	assertEquals(keyOf({ approvalThresholdMinor: over }), ["approvalThresholdMinor"]);
	assertEquals(keyOf({ limits: [{ memberId: "m", limitMinor: over }] }), ["limits.0.limitMinor"]);
	assertEquals(keyOf({ limits: [{ memberId: "m", perTransactionMinor: 1e19 }] }), [
		"limits.0.perTransactionMinor",
	]);
	assertEquals(keyOf({ approvalThresholdMinor: Number.MAX_SAFE_INTEGER }), null);
});

Deno.test("walletHrefFor: the access section lands on the entity wallet's approvals", () => {
	assertEquals(walletHrefFor("business", "b-1"), "/wallet?w=business:b-1");
	assertEquals(walletHrefFor("business", "b-1", "access"), "/wallet?w=business:b-1#upcoming");
});

Deno.test("the archive blockers each kind's SQL lists are the codes the schema admits (C6)", () => {
	/** The `'code', '<x>'` literals a blocker function builds, in order. */
	const codes = (name: string) =>
		[...functionBody(entities, name).matchAll(/'code', '([a-z_]+)'/g)].map((m) => m[1]);
	assertEquals(codes("org.fn_team_archive_blockers"), [...TeamArchiveBlockerCode.options]);
	assertEquals(codes("org.fn_business_archive_blockers"), [...BusinessArchiveBlockerCode.options]);
	for (const code of [...TeamArchiveBlockerCode.options, ...BusinessArchiveBlockerCode.options]) {
		assert(ArchiveBlockerSchema.safeParse({ code, count: 1 }).success, `${code} is not admitted`);
	}
	// The detail answers a team's list too, and the door refuses on the same function's first entry.
	assert(detailBody.includes("org.fn_team_archive_blockers(v_e.id)"));
	assert(
		functionBody(entities, "org.set_workspace_status").includes(
			"org.fn_team_archive_blockers(p_id)",
		),
	);
});

Deno.test("a restore lands where the server decides, in every word the contract uses (C6)", () => {
	const door = functionBody(entities, "org.set_workspace_status");
	const accepted = /p_status NOT IN \(([^)]*)\)/.exec(door);
	assert(accepted, "set_workspace_status no longer lists the statuses it accepts");
	assertEquals(literals(accepted[1]), [...WorkspaceStatusChange.options]);
	assert(door.includes(`'${RESTORE_TARGET_REASON}: '`), "the wrong-target refusal's prefix moved");
	assert(door.includes("org.fn_workspace_restore_target(p_kind, p_id)"));
	const target = functionBody(entities, "org.fn_workspace_restore_target");
	assertEquals(
		literals(target.slice(target.lastIndexOf("THEN"))).filter((l) =>
			RestoreTarget.safeParse(l).success
		),
		[...RestoreTarget.options].reverse(),
		"the target function answers exactly the two RestoreTarget values",
	);
	assert(
		detailBody.includes("'restore_target'"),
		"get_workspace_detail no longer names the target",
	);
	assertEquals(WorkspaceDetailSchema.shape.restoreTarget.parse(undefined), null);
});

Deno.test("WorkspaceDetailSchema: the business blocks default to absent for a team", () => {
	const shape = WorkspaceDetailSchema.shape;
	assertEquals(shape.moneyTiles.parse(undefined), []);
	assertEquals(shape.viewerCan.parse(undefined), null);
	assertEquals(shape.kyb.parse(undefined), null);
});

// #endregion

// #region The payout preview (Teams C4)

const KYC_WALLET_SQL = "supabase/migrations/00001210_functions_finance_kyc_wallet.sql";
const GRANTS_SQL = "supabase/migrations/00002510_permissions_function_grants.sql";

Deno.test("finance.preview_team_split prices a chosen amount, and only that signature is granted", () => {
	const sql = read(KYC_WALLET_SQL);
	assert(
		sql.includes(
			"CREATE OR REPLACE FUNCTION finance.preview_team_split(p_team_id uuid, p_gross_minor bigint DEFAULT NULL)",
		),
		"preview_team_split must take an optional gross in minor units",
	);
	const body = functionBody(sql, "finance.preview_team_split");
	assert(
		body.includes("finance.fn_team_split_plan(p_team_id, v_payout)"),
		"one plan, the release's",
	);
	assert(body.includes("'finder_bp'"), "the finder's rate travels with the preview");
	assert(
		body.includes("org.fn_member_can('team', p_team_id, 'manage_finances')"),
		"the split rule and stakes are answered to manage_finances holders only (Decision #233 (b))",
	);
	assert(
		body.indexOf("'manage_finances'") < body.indexOf("finance.fn_team_split_plan"),
		"the gate runs before any plan is priced",
	);
	const grants = read(GRANTS_SQL);
	assert(
		grants.includes(
			"GRANT EXECUTE ON FUNCTION finance.preview_team_split (uuid, bigint) TO authenticated;",
		),
	);
	assert(!grants.includes("finance.preview_team_split (uuid) "), "the one-argument grant is gone");
});

Deno.test("PayoutPreviewQuerySchema: a query-string amount is coerced; 1 … 10^12 minor units only", () => {
	const parsed = PayoutPreviewQuerySchema.safeParse({
		workspaceId: "t1",
		amountMinor: "100000",
		currency: "GBP",
	});
	assert(parsed.success);
	assertEquals(parsed.data.amountMinor, 100_000);
	for (const amountMinor of ["0", "-5", "1.5", "1000000000001", "", "abc"]) {
		assert(
			!PayoutPreviewQuerySchema.safeParse({ workspaceId: "t1", amountMinor, currency: "GBP" })
				.success,
			`amount ${amountMinor}`,
		);
	}
	assert(
		!PayoutPreviewQuerySchema.safeParse({ workspaceId: "t1", amountMinor: "100", currency: "gbp" })
			.success,
	);
});

Deno.test("TeamPayoutPolicySchema: no plan answer is co_op only; no vault answer is no readout", () => {
	const shape = TeamPayoutPolicySchema.shape;
	assertEquals(shape.unlockedTemplates.parse(undefined), ["co_op"]);
	assertEquals(shape.vaultAccess.parse(undefined), []);
	assert(!shape.unlockedTemplates.safeParse(["by_role"]).success);
});

// #endregion
