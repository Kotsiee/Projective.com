import { z } from "zod";
import { ContextType } from "../auth/mod.ts";

/**
 * projects.create — the Zod SSOT for the **Quick-Init** Create-Project modal payload.
 *
 * Design intent (PRODUCT_SPEC §Projects): "quick to onboard, slow to set up". This shape is
 * deliberately the SMALLEST payload that can mint a coherent draft, and nothing more. Everything a
 * project eventually needs — the brief, the rules, the stage architecture, the staffing — is
 * collected on the Stage-2 workspace surface at `/projects/[projectId]` through
 * {@link UpdateProjectSchema}, not here.
 *
 * The split is not stylistic. A modal that collects a stage list has to be closed before the owner
 * can look anything up, and a half-filled one loses everything on dismiss; a draft row loses
 * nothing. So the modal's only job is to reach a URL, and the URL is where the work happens.
 *
 * Every field below is create-BLOCKING except `baselineAmountCents`, and each maps onto a
 * `projects.projects` column that already exists — `title`, `format`, `currency` — or onto the one
 * auto-provisioned root stage the service creates alongside the row. The DB derives id, owner,
 * status, visibility, slug and timestamps; the client never proposes any of them.
 */

// #region Budget vocabulary
/**
 * `finance.budget_type` — how a stage or engagement is priced.
 *
 * Declared here rather than in `./setup.ts` because it is the older of the two modules and
 * {@link ProjectBudgetSchema} imports it; moving it now would only relocate the same one-line enum.
 */
export const BudgetType = z.enum(["fixed_price", "hourly_cap"]);
export type BudgetType = z.infer<typeof BudgetType>;
// #endregion

// #region Format
/**
 * The two work-flows a CLIENT can commission from the Quick-Init modal.
 *
 *  - `pipeline` — a multi-stage workflow, priced per ticket;
 *  - `one_off`  — a single funded deliverable, priced as one escrow budget.
 *
 * Deliberately two members, not three and not four:
 *
 * **`session` is excluded** because a session is a SERVICE a freelancer sells, not a project a
 * client posts — it is created provider-side from the catalogue composer, and `projects.projects`
 * only ever receives one by instantiation. Offering it here would let a buyer mint an engagement
 * with no seller and no schedule.
 *
 * **`direct_deliverable` is retired.** It was a third modal vocabulary that had to be stored as
 * `format: "one_off"` + `structure: "single_task"`, so this enum and the `project_format` column
 * disagreed and a bridge docblock existed to explain the mismatch. With it gone the mapping onto the
 * column is the IDENTITY function. The distinction it drew survives intact one level down as
 * {@link ProjectStructure}`.single_task`, which is what the setup form branches on — so an existing
 * Direct Deliverable stays fully editable; it simply can no longer be BORN from this modal, where a
 * client had to choose between three words before they had written a sentence.
 */
export const ProjectCreateFormat = z.enum(["one_off", "pipeline"]);
export type ProjectCreateFormat = z.infer<typeof ProjectCreateFormat>;

/** The heading a format gives its single baseline price at Quick-Init. */
export const BASELINE_PRICE_LABEL: Record<ProjectCreateFormat, string> = {
	pipeline: "Default ticket price",
	one_off: "Escrow budget",
};

/** What the baseline figure BUYS, in the words the modal shows beneath the field. */
export const BASELINE_PRICE_HINT: Record<ProjectCreateFormat, string> = {
	pipeline: "The starting rate for one ticket. Each stage can override it later.",
	one_off: "The full amount held in escrow for this deliverable.",
};

/** One sentence per format, shown under the type selector. */
export const FORMAT_HINT: Record<ProjectCreateFormat, string> = {
	pipeline: "Ongoing work, ticket by ticket, across as many stages as you need.",
	one_off: "One fixed deliverable for one agreed price.",
};
// #endregion

// #region Create payload
/**
 * The Quick-Init payload.
 *
 * `currency` is TOP-LEVEL rather than nested under a budget, for three reasons that are each a real
 * defect avoided. A pipeline's baseline is a per-ticket RATE and not a budget at all, so a nested
 * currency would be unreachable on exactly half the formats. A nested field's Zod error path is
 * `budget.currency`, which no control on the modal binds, so the refusal would land on nothing. And
 * the database agrees with the flat shape: `currency` is a column on `projects.projects` while
 * `project_stages` has none, because a stage price is denominated in its project's currency — there
 * is exactly one place for it, and this is it.
 *
 * It is a stored ORIGIN, not a presentation choice: it prices escrow. The modal SEEDS it from the
 * viewer's display preference as a convenience and then it is fixed to the project — a viewer later
 * switching how they like to READ money must never move what a project is priced in.
 *
 * `baselineAmountCents` is nullable because "priced" and "free" are different facts and a figure
 * defaulted to zero would satisfy the setup ladder's pricing step with a number nobody typed. It is
 * the ONE optional field here: a draft may legitimately be minted before the client knows the
 * number, and the Stage-2 surface will ask for it again.
 */
export const CreateProjectSchema = z.object({
	/**
	 * Minimum three characters rather than one: the title is the project's address bar, its feed card
	 * and its channel header, and a one-character project is indistinguishable from a mis-key. Long
	 * enough to be a name, short enough not to be a brief.
	 */
	title: z.string().trim().min(3, "Give your project a name of at least 3 characters.").max(
		160,
		"Keep the name under 160 characters.",
	),
	format: ProjectCreateFormat,
	/**
	 * ISO-4217, upper-case. Validated for SHAPE here and narrowed to the offerable set server-side
	 * through `toDisplayCurrency`, so a client that posts a well-formed but unsupported code gets the
	 * platform default rather than a refusal it cannot act on.
	 */
	currency: z.string().trim().length(3, "Choose a currency.").toUpperCase(),
	/** The one baseline figure, in MINOR units. `null` = not priced yet. */
	baselineAmountCents: z.number().int().min(0).nullable().default(null),
	/** Which workspace to create the engagement under; defaults to the actor's active context. */
	scopeType: ContextType.default("personal"),
	scopeId: z.string().max(64).default(""),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

/**
 * What a successful create returns.
 *
 * BOTH identifiers, deliberately. `id` is the canonical address the client navigates to — a uuid
 * cannot collide, cannot be squatted and cannot change when the owner renames the project, which a
 * title-derived slug does on the first rename. `slug` rides along because every projection in this
 * domain carries it and a caller that wants a readable link should not have to fetch the row again
 * to get one.
 */
export const CreatedProjectSchema = z.object({
	id: z.string().uuid(),
	slug: z.string().min(1).max(120),
});
export type CreatedProject = z.infer<typeof CreatedProjectSchema>;
// #endregion
