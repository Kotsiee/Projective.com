import type { ProjectDetail, ProjectStatus, StageChannel } from "../types/projects-types.ts";
import type {
	ExploreOwner,
	ProjectClassification,
	ProjectItem,
	ProjectMetric,
	ProjectStage,
	ProjectStageStatus,
	ProjectViewExtra,
	TicketPrice,
} from "@projective/types/explore";

/**
 * showcase-model — the PURE (client-safe, no `@server`) adapter that projects a deep
 * {@link ProjectDetail} onto the discovery showcase shapes (`ExploreItem` + {@link ProjectViewExtra})
 * the shared `/view/[id]?type=projects` template renders. It is what lets `/projects/[projectId]` reuse
 * the exact same showcase body/header as the public entity-view page (root brief §1 "Main Body Layout
 * Mirroring").
 *
 * The two corpora are disjoint and the projects read model is deliberately thin — it carries identity +
 * the stage/channel tree + members, but NOT the rich stage descriptions / recruiting roles / seat pools
 * / per-ticket pricing / finance that a fully-composed discovery listing invents. So this adapter maps
 * the **real** project data it does have (title, owner, description, `format`→classification, and the
 * real stage names/statuses/order from the channel tree) and leaves the rich fields **empty** — the
 * showcase components render those as graceful placeholders / owner edit-prompts (root brief §1
 * "Handling Incomplete Data"). Nothing is invented, so the Preview is an honest reflection of how far
 * the engagement is set up.
 */

// #region Everything-derived-here
/** The showcase projection of a project — exactly what the shared view components consume. */
export interface ProjectShowcase {
	item: ProjectItem;
	project: ProjectViewExtra;
}

/** A tiny stable hash of a string → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = (h * 16777619) ^ s.charCodeAt(i);
	return h >>> 0;
}

/** Deterministic fallback banner scenes (7:2-ish landscapes) for a project with no service banner. */
const BANNERS = [
	"photo-1550859492-d5da9d8e45f3",
	"photo-1557682250-33bd709cbe85",
	"photo-1579546929518-9e396f3cc809",
	"photo-1614850523459-c2f4c699c52e",
	"photo-1508614999368-9260051292e5",
];

function bannerFor(detail: ProjectDetail): string {
	if (detail.bannerImage) return detail.bannerImage;
	const id = BANNERS[hash(detail.slug) % BANNERS.length];
	return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1600&h=460&q=80`;
}

/** URL-safe slug fallback when a party carries no `@handle`. */
function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "member";
}

/** An empty per-ticket price — the showcase renders it as a "pricing not set" placeholder. */
const NO_PRICE: TicketPrice = { min: 0, max: 0, label: "" };

/** Map the engagement `format` onto the showcase's pipeline/one-off classification. */
function classificationOf(detail: ProjectDetail): ProjectClassification {
	return detail.format === "pipeline" ? "pipeline" : "one-off";
}

/** Map a stage-channel lifecycle status onto the stage-flow visualizer's three-state treatment. */
function stageStatusOf(status: ProjectStatus): ProjectStageStatus {
	if (status === "completed") return "completed";
	if (status === "active") return "active";
	return "upcoming";
}

/** Map the engagement owner (a thin `ProjectParty`) onto the showcase's `ExploreOwner`. */
function ownerOf(detail: ProjectDetail): ExploreOwner {
	const p = detail.owner;
	return {
		handle: p.handle ?? slugify(p.name),
		name: p.name,
		// ExploreOwner.avatar is a required string; "" makes the Avatar fall back to initials.
		avatar: p.avatar ?? "",
		// Provider-side identity — the project read model doesn't carry an entity kind, so default to an
		// individual (circular avatar). Buyer-only orgs still render their name/handle correctly.
		kind: "user",
	};
}

/**
 * Map the real stage-channel tree onto stage-flow stages. Names/statuses/order are REAL; the rich
 * per-stage fields (description, seats, roles, pricing, skills) are intentionally empty so the flow
 * renders them as placeholders / edit-prompts.
 */
function stagesOf(stages: StageChannel[]): ProjectStage[] {
	return [...stages]
		.sort((a, b) => a.order - b.order)
		.map((s, i) => ({
			id: s.id,
			index: i + 1,
			name: s.name,
			description: "",
			status: stageStatusOf(s.status),
			seatKind: "seats",
			openSeats: 0,
			seatsTotal: 0,
			seatsFilled: 0,
			roles: [],
			price: NO_PRICE,
			skills: [],
		}));
}

/**
 * Project a {@link ProjectDetail} onto the shared showcase shapes. Deterministic + pure — safe to run in
 * SSR and to pass the result to islands as props.
 */
export function buildProjectShowcase(detail: ProjectDetail): ProjectShowcase {
	const classification = classificationOf(detail);
	const isPipeline = classification === "pipeline";
	const stages = stagesOf(detail.channels.stages);
	const activeStage = stages.find((s) => s.status === "active");
	const classificationLabel = isPipeline ? "Pipeline" : "One-Off";

	const item: ProjectItem = {
		id: detail.slug,
		type: "projects",
		title: detail.title,
		owner: ownerOf(detail),
		skills: [],
		summary: detail.description,
		// A fixed epoch — the projects showcase never sorts by recency (that is a discovery-feed concern).
		createdAt: "2026-01-01T00:00:00.000Z",
		org: detail.scopeLabel,
		stage: activeStage?.name ?? "",
		budget: "",
		classification,
		roles: [],
		phases: stages.map((s) => s.name),
	};

	// Type-tailored metric chips — mirrors the discovery derivation, minus the fields we can't populate
	// (ticket price / open seats stay out until the engagement is configured).
	const metrics: ProjectMetric[] = [
		{ icon: "type", label: "Type", value: classificationLabel },
	];
	if (isPipeline) metrics.push({ icon: "stages", label: "Stages", value: `${stages.length}` });

	const project: ProjectViewExtra = {
		banner: bannerFor(detail),
		ownerHeadline: `${detail.typeLabel} · ${detail.scopeLabel}`,
		ownerVerified: false,
		classification,
		classificationLabel,
		stage: isPipeline ? activeStage?.name : undefined,
		stages,
		finance: { ticketPrice: NO_PRICE, openSeats: 0, totalSeats: 0 },
		metrics,
	};

	return { item, project };
}
// #endregion
