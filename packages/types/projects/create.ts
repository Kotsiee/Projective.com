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
	description: z.string().max(2000).default(""),
	/** Pipeline per-ticket unit price in cents (→ `project_stages.unit_price_cents`); null = unset. */
	unitPriceCents: z.number().int().min(0).nullable().default(null),
});
export type CreateProjectStage = z.infer<typeof CreateProjectStageSchema>;
// #endregion

// #region Create payload
/**
 * The Create-Project modal payload. `title` + `format` are the only hard requirements; the modal
 * ships the rest empty when the actor onboards quickly and fills the disclosures otherwise. `format`
 * is limited to the two client-architected work-flows the modal offers (Pipeline vs One-off);
 * Session services are provider-side and created from the service composer, not here.
 */
export const CreateProjectSchema = z.object({
	title: z.string().min(1, "Name your project.").max(160),
	/** Project Type — the second (and only other) mandatory field. */
	format: z.enum(["pipeline", "one_off"]),
	/** Which workspace to create the engagement under; defaults to the actor's active context. */
	scopeType: ContextType.default("personal"),
	scopeId: z.string().max(64).default(""),
	/** Rich-text scope/brief (plain string for now; a jsonb rich doc when the editor lands). */
	scope: z.string().max(8000).default(""),
	/** Optional budget metric. */
	budget: CreateProjectBudgetSchema.nullable().default(null),
	/** Optional inline phase stages. */
	stages: z.array(CreateProjectStageSchema).max(50).default([]),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;
// #endregion
