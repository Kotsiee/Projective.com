import type { ProjectSummary, ScopeOption, ServiceOption } from "@projective/types/projects";
import { mockAvatar } from "../../mocks/assets.ts";

/**
 * projects fixtures — the in-memory corpus the fat {@link ProjectBackendService} answers the
 * `/projects` feed from while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md
 * §10). Deliberately spans the full multi-tenant matrix for ONE acting account: an independent
 * freelancer who is also a member of a Team, an admin of a Business, and a member of a buyer-only
 * Organisation — so every scope toggle, role filter, and the client-by-service filter have real
 * data to exercise. When the live path lands, the RLS-scoped `projects.*` + `org.*` reads replace
 * these arrays behind the same gate, with zero shape churn (the rows are already the SSOT
 * {@link ProjectSummary}). No RNG — deterministic so SSR/resume are stable.
 */

// #region Scopes (the workspaces the acting account belongs to)
/** The acting account's own personal/freelancer space id (stands in for the user id). */
export const PERSONAL_ID = "u_ahmed";
/** Northwind Studio — a freelancer-side Team the actor is a member of. */
export const TEAM_NORTHWIND = "t_northwind";
/** Monarch Labs — a client-side Business the actor administers. */
export const BUSINESS_MONARCH = "b_monarch";
/** Helios Corp — a buyer-only Organisation the actor belongs to. */
export const ORG_HELIOS = "o_helios";
// #endregion

// #region Avatars (Unsplash face crops — open registry, DESIGN_SYSTEM.md §C.4)
const FACE = (id: string) =>
	mockAvatar(id);

const MARA = FACE("photo-1494790108377-be9c29b29330");
const DANIEL = FACE("photo-1500648767791-00dcc994a43e");
const PRIYA = FACE("photo-1438761681033-6461ffad8d80");
const THEO = FACE("photo-1507003211169-0a1dd7228f2d");
const LENA = FACE("photo-1544005313-94ddf0286df2");
const OMAR = FACE("photo-1506794778202-cad84cf45f1d");
const SOFIA = FACE("photo-1534528741775-53994a69daeb");
const NOAH = FACE("photo-1531427186611-ecfd6d936c79");
// #endregion

// #region Provider services (for the "Clients by Service Provider" filter)
const SVC_BRAND = "s_brand_identity";
const SVC_WEBAPP = "s_webapp_build";
const SVC_MOTION = "s_motion_system";

const SERVICES: readonly ServiceOption[] = [
	{ id: SVC_BRAND, name: "Brand Identity Sprint", clientCount: 3 },
	{ id: SVC_WEBAPP, name: "Web App Build", clientCount: 2 },
	{ id: SVC_MOTION, name: "Motion System", clientCount: 1 },
];
// #endregion

// #region Engagements
/** A tiny helper to keep row literals dense and consistent. */
function party(name: string, avatar: string | null, handle: string | null = null) {
	return { name, avatar, handle };
}

const PROJECTS: readonly ProjectSummary[] = [
	// —— Personal / freelancer space —————————————————————————————————————————————
	{
		id: "11111111-1111-4111-8111-111111111101",
		slug: "aurora-rebrand",
		title: "Aurora Rebrand",
		kind: "service",
		format: "pipeline",
		status: "active",
		viewerRole: "freelancer",
		scopeType: "personal",
		scopeId: PERSONAL_ID,
		scopeLabel: "Personal",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Mara Ellison", MARA, "mara"),
		serviceId: SVC_BRAND,
		unread: true,
		starred: true,
		completedStages: 2,
		totalStages: 5,
		activity: "new_ticket",
		budgetLabel: "$4,200",
		updatedAt: "2026-07-15T09:12:00Z",
	},
	{
		id: "11111111-1111-4111-8111-111111111102",
		slug: "helio-app",
		title: "Helio App Build",
		kind: "service",
		format: "pipeline",
		status: "active",
		viewerRole: "freelancer",
		scopeType: "personal",
		scopeId: PERSONAL_ID,
		scopeLabel: "Personal",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Theo Marsh", THEO, "theo"),
		serviceId: SVC_WEBAPP,
		unread: false,
		starred: false,
		completedStages: 4,
		totalStages: 9,
		activity: "pending_review",
		budgetLabel: "$12,800",
		updatedAt: "2026-07-14T16:40:00Z",
	},
	{
		id: "11111111-1111-4111-8111-111111111103",
		slug: "gradient-motion-kit",
		title: "Gradient Motion Kit",
		kind: "service",
		format: "one_off",
		status: "completed",
		viewerRole: "freelancer",
		scopeType: "personal",
		scopeId: PERSONAL_ID,
		scopeLabel: "Personal",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Sofia Marin", SOFIA, "sofia"),
		serviceId: SVC_MOTION,
		unread: false,
		starred: false,
		completedStages: 1,
		totalStages: 1,
		budgetLabel: "$1,900",
		updatedAt: "2026-07-02T11:05:00Z",
	},
	{
		id: "11111111-1111-4111-8111-111111111104",
		slug: "brand-clinic-sofia",
		title: "Brand Clinic — Sofia",
		kind: "service",
		format: "session",
		status: "active",
		viewerRole: "freelancer",
		scopeType: "personal",
		scopeId: PERSONAL_ID,
		scopeLabel: "Personal",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Sofia Marin", SOFIA, "sofia"),
		serviceId: SVC_BRAND,
		unread: true,
		starred: false,
		completedStages: null,
		totalStages: null,
		activity: "revision_requested",
		nextSessionLabel: "Thu, Jul 17 · 2:30 PM",
		budgetLabel: "$320 / session",
		updatedAt: "2026-07-15T07:55:00Z",
	},
	{
		id: "11111111-1111-4111-8111-111111111105",
		slug: "mercury-landing",
		title: "Mercury Landing Page",
		kind: "service",
		format: "one_off",
		status: "on_hold",
		viewerRole: "freelancer",
		scopeType: "personal",
		scopeId: PERSONAL_ID,
		scopeLabel: "Personal",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Omar Haddad", OMAR, "omar"),
		serviceId: SVC_WEBAPP,
		unread: false,
		starred: true,
		completedStages: 0,
		totalStages: 3,
		activity: "service_request",
		budgetLabel: "$2,600",
		updatedAt: "2026-07-09T13:20:00Z",
	},

	// —— Northwind Studio (Team, freelancer-side) ————————————————————————————————
	{
		id: "22222222-2222-4222-8222-222222222201",
		slug: "northwind-atlas-portal",
		title: "Atlas Investor Portal",
		kind: "project",
		format: "pipeline",
		status: "active",
		viewerRole: "member",
		scopeType: "team",
		scopeId: TEAM_NORTHWIND,
		scopeLabel: "Northwind Studio",
		owner: party("Daniel Okafor", DANIEL, "daniel"),
		counterparty: party("Atlas Collective", LENA, "atlas"),
		serviceId: null,
		unread: true,
		starred: false,
		completedStages: 3,
		totalStages: 6,
		activity: "new_ticket",
		budgetLabel: "$28,000",
		updatedAt: "2026-07-15T08:30:00Z",
	},
	{
		id: "22222222-2222-4222-8222-222222222202",
		slug: "northwind-ops-retainer",
		title: "Ops Design Retainer",
		kind: "project",
		format: "pipeline",
		status: "active",
		viewerRole: "admin",
		scopeType: "team",
		scopeId: TEAM_NORTHWIND,
		scopeLabel: "Northwind Studio",
		owner: party("Ahmed K.", null, "ahmed"),
		counterparty: party("Lena Fischer", LENA, "lena"),
		serviceId: null,
		unread: false,
		starred: true,
		completedStages: 7,
		totalStages: 12,
		activity: "pending_review",
		budgetLabel: "$6,000 / mo",
		updatedAt: "2026-07-13T18:02:00Z",
	},
	{
		id: "22222222-2222-4222-8222-222222222203",
		slug: "northwind-summit-deck",
		title: "Summit Keynote Deck",
		kind: "project",
		format: "one_off",
		status: "draft",
		viewerRole: "member",
		scopeType: "team",
		scopeId: TEAM_NORTHWIND,
		scopeLabel: "Northwind Studio",
		owner: party("Daniel Okafor", DANIEL, "daniel"),
		counterparty: null,
		serviceId: null,
		unread: false,
		starred: false,
		completedStages: 0,
		totalStages: 4,
		budgetLabel: null,
		updatedAt: "2026-07-11T10:15:00Z",
	},

	// —— Monarch Labs (Business, client-side) ————————————————————————————————————
	{
		id: "33333333-3333-4333-8333-333333333301",
		slug: "monarch-design-system",
		title: "Monarch Design System",
		kind: "project",
		format: "pipeline",
		status: "active",
		viewerRole: "admin",
		scopeType: "business",
		scopeId: BUSINESS_MONARCH,
		scopeLabel: "Monarch Labs",
		owner: party("Priya Nair", PRIYA, "priya"),
		counterparty: party("Northwind Studio", DANIEL, "northwind"),
		serviceId: null,
		unread: true,
		starred: true,
		completedStages: 5,
		totalStages: 8,
		activity: "revision_requested",
		budgetLabel: "$41,000",
		updatedAt: "2026-07-15T06:20:00Z",
	},
	{
		id: "33333333-3333-4333-8333-333333333302",
		slug: "monarch-growth-site",
		title: "Growth Marketing Site",
		kind: "project",
		format: "one_off",
		status: "active",
		viewerRole: "admin",
		scopeType: "business",
		scopeId: BUSINESS_MONARCH,
		scopeLabel: "Monarch Labs",
		owner: party("Priya Nair", PRIYA, "priya"),
		counterparty: party("Noah Bennett", NOAH, "noah"),
		serviceId: null,
		unread: false,
		starred: false,
		completedStages: 1,
		totalStages: 3,
		budgetLabel: "$9,400",
		updatedAt: "2026-07-12T14:48:00Z",
	},
	{
		id: "33333333-3333-4333-8333-333333333303",
		slug: "monarch-support-maintenance",
		title: "Product Support & Maintenance",
		kind: "project",
		format: "pipeline",
		status: "on_hold",
		viewerRole: "admin",
		scopeType: "business",
		scopeId: BUSINESS_MONARCH,
		scopeLabel: "Monarch Labs",
		owner: party("Priya Nair", PRIYA, "priya"),
		counterparty: party("Atlas Collective", LENA, "atlas"),
		serviceId: null,
		unread: false,
		starred: false,
		completedStages: 12,
		totalStages: 20,
		budgetLabel: "$3,200 / mo",
		updatedAt: "2026-07-05T09:00:00Z",
	},

	// —— Helios Corp (Organisation, buyer-only) ——————————————————————————————————
	{
		id: "44444444-4444-4444-8444-444444444401",
		slug: "helios-brand-refresh",
		title: "Helios Brand Refresh",
		kind: "project",
		format: "pipeline",
		status: "active",
		viewerRole: "member",
		scopeType: "organisation",
		scopeId: ORG_HELIOS,
		scopeLabel: "Helios Corp",
		owner: party("Omar Haddad", OMAR, "omar"),
		counterparty: party("Northwind Studio", DANIEL, "northwind"),
		serviceId: null,
		unread: true,
		starred: false,
		completedStages: 2,
		totalStages: 7,
		activity: "client_invite",
		budgetLabel: "$64,000",
		updatedAt: "2026-07-14T21:10:00Z",
	},
	{
		id: "44444444-4444-4444-8444-444444444402",
		slug: "helios-annual-report",
		title: "Annual Report Production",
		kind: "project",
		format: "one_off",
		status: "completed",
		viewerRole: "member",
		scopeType: "organisation",
		scopeId: ORG_HELIOS,
		scopeLabel: "Helios Corp",
		owner: party("Omar Haddad", OMAR, "omar"),
		counterparty: party("Mara Ellison", MARA, "mara"),
		serviceId: null,
		unread: false,
		starred: false,
		completedStages: 3,
		totalStages: 3,
		budgetLabel: "$18,500",
		updatedAt: "2026-06-28T12:00:00Z",
	},
];
// #endregion

// #region Accessors
/** Every engagement the acting account is involved with (all scopes) — the global corpus. */
export function allProjects(): readonly ProjectSummary[] {
	return PROJECTS;
}

/** The workspaces the acting account belongs to (the scope matrix), with per-scope counts. */
export function allScopes(): readonly ScopeOption[] {
	const base: ScopeOption[] = [
		{
			id: PERSONAL_ID,
			type: "personal",
			label: "Personal",
			handle: "ahmed",
			role: "owner",
			count: 0,
		},
		{
			id: TEAM_NORTHWIND,
			type: "team",
			label: "Northwind Studio",
			handle: "northwind",
			role: "member",
			count: 0,
		},
		{
			id: BUSINESS_MONARCH,
			type: "business",
			label: "Monarch Labs",
			handle: "monarch",
			role: "admin",
			count: 0,
		},
		{
			id: ORG_HELIOS,
			type: "organisation",
			label: "Helios Corp",
			handle: "helios",
			role: "member",
			count: 0,
		},
	];
	for (const scope of base) {
		scope.count = PROJECTS.filter((p) => p.scopeId === scope.id).length;
	}
	return base;
}

/** The acting account's provider services (for the client-by-service filter). */
export function allServices(): readonly ServiceOption[] {
	return SERVICES;
}
// #endregion
