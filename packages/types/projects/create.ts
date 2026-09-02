import { z } from "zod";
import { ContextType } from "../auth/mod.ts";

/**
 * projects.create — the Zod SSOT for the "Create New Project" modal payload.
 *
 * Design intent (PRODUCT_SPEC §Projects): "quick to onboard, slow to set up". Only **name** and
 * **type** are mandatory; every deeper configuration (owning workspace, rich scope, budget, phase
 * stages) is optional and supplied inline via disclosures. These fields map onto
 * `projects.projects` (+ `projects.project_stages`) columns; the DB derives id/owner/status/
 * timestamps and the escrow wiring. The same schema validates client-side (modal), in the thin
 * route, and in the fat service (mirrors `org/organisations.ts`'s Create shape).
 */

// #region Optional deep-config sub-shapes
/** `finance.budget_type` — how a stage/engagement is priced. */
export const BudgetType = z.enum(["fixed_price", "hourly_cap"]);
export type BudgetType = z.infer<typeof BudgetType>;

/** An optional budget metric for the engagement (mapped to stage budget rules on the server). */
export const CreateProjectBudgetSchema = z.object({
	budgetType: BudgetType,
	/** Amount in minor units (cents) — integer, non-negative. */
	amountCents: z.number().int().min(0),
	currency: z.string().min(1).max(8).default("USD"),
});
export type CreateProjectBudget = z.infer<typeof CreateProjectBudgetSchema>;

/** An optional phase/stage the actor sketches inline (name required; the rest is deferrable). */
export const CreateProjectStageSchema = z.object({
	name: z.string().min(1).max(120),
	/** Rich-text scope (HTML) for the stage — optional; the AMBER publishing gate, not create-blocking. */
	description: z.string().max(4000).default(""),
	/** Pipeline per-ticket unit price in cents (→ `project_stages.unit_price_cents`); null = unset. */
	unitPriceCents: z.number().int().min(0).nullable().default(null),
	/** Estimated delivery / milestone note (free text); optional. */
	milestone: z.string().max(240).default(""),
});
export type CreateProjectStage = z.infer<typeof CreateProjectStageSchema>;

/**
 * An optional team role for a **Direct Deliverable** (single mini-task) engagement, which takes no
 * stages. `name` is required once a role is added; `skills` are freeform tags. Maps to the eventual
 * `projects.project_roles` rows on the live path.
 */
export const CreateProjectRoleSchema = z.object({
	name: z.string().min(1).max(120),
	skills: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CreateProjectRole = z.infer<typeof CreateProjectRoleSchema>;
// #endregion

// #region Create payload
/**
 * The Create-Project modal payload. `title` is the ONLY hard (RED) requirement — a title-only project
 * is a valid draft (the quick-creation philosophy). `format` defaults to `pipeline` and offers the
 * three client-architected work-flows the modal presents:
 *  - `pipeline` — a multi-stage workflow with per-stage ticket limits;
 *  - `one_off` — a milestone/deliverable-based stage workflow;
 *  - `direct_deliverable` — a single mini-task that takes **no stages** and instead defines optional
 *    team roles.
 * Session services stay provider-side (created from the service composer, not here). Everything below
 * `format` is the AMBER publishing gate — optional to draft, needed before posting to Explore/hiring.
 */
export const ProjectCreateFormat = z.enum(["pipeline", "one_off", "direct_deliverable"]);
export type ProjectCreateFormat = z.infer<typeof ProjectCreateFormat>;

/**
 * The URL-safe address derived from a title.
 *
 * Shared rather than duplicated because `projects.projects.slug` carries a CHECK
 * (`^[a-z0-9-]{1,96}$`) and the route tree interpolates the value into a path segment verbatim: a
 * second slugifier that disagreed by one character would produce an engagement that exists and
 * cannot be opened. Truncated to 80 so the database's own disambiguating suffix still fits inside 96.
 *
 * Returns `""` for a title with nothing usable in it (punctuation only, or a non-Latin script). That
 * is deliberate and is NOT an error: the caller falls back to the column's generated `p-<hex>`
 * default, which is a valid address, rather than inventing prose the author did not write.
 */
export function projectSlugFrom(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/, "");
}

/**
 * What a create returns: the two durable identifiers, both of them.
 *
 * `slug` is what every `/projects/*` route addresses an engagement by, so it is what the client
 * navigates to. `id` is the primary key and the only thing a later write may safely reference — a
 * slug can be rewritten, a uuid cannot. Returning one without the other would force the caller to go
 * and read the row back for the half it was not given.
 */
export const CreatedProjectSchema = z.object({
	id: z.string().min(1).max(64),
	slug: z.string().min(1).max(96),
});
export type CreatedProject = z.infer<typeof CreatedProjectSchema>;

export const CreateProjectSchema = z.object({
	title: z.string().min(1, "Name your project.").max(160),
	/** Project Type. Defaults to `pipeline`; no longer create-blocking (only the title is RED). */
	format: ProjectCreateFormat.default("pipeline"),
	/** Which workspace to create the engagement under; defaults to the actor's active context. */
	scopeType: ContextType.default("personal"),
	scopeId: z.string().max(64).default(""),
	/** Rich-text scope/brief (semantic HTML from the RichTextEditor). AMBER publishing gate. */
	scope: z.string().max(8000).default(""),
	/** Optional budget metric. */
	budget: CreateProjectBudgetSchema.nullable().default(null),
	/** Optional inline phase stages (Pipeline / One-off only; empty for Direct Deliverable). */
	stages: z.array(CreateProjectStageSchema).max(50).default([]),
	/** Optional team roles (Direct Deliverable only; empty for staged formats). */
	roles: z.array(CreateProjectRoleSchema).max(20).default([]),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;
// #endregion
