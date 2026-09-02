import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { CreateProjectSchema, ProjectWizardField } from "@projective/types/projects";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";

/**
 * `POST /api/projects/create` — thin route: Zod-validate the Create-Project payload (a name is the
 * only hard requirement), map any issues to field errors, then delegate to the fat
 * {@link ProjectBackendService}, which persists the engagement and returns the two identifiers it can
 * be addressed by.
 *
 * **The session has to reach the service.** Everything a create writes is scoped to the acting
 * identity — the owner column, the workspace it is filed under, the RLS context the whole insert runs
 * in — so an actor is not optional plumbing here, it is the subject of the write. The route
 * previously called the service with the payload alone, which is why nothing could be persisted.
 *
 * **No capability guard.** A server-side owner/`isFreelancer` bounce is forbidden: the Dev Context
 * Switcher's persona is a client seam the server never sees, so the gate would fire on a simulated
 * persona. RLS is the real gate (Decision #53(b)). The 401 below is an identity check, not a
 * capability one — a project has to belong to somebody.
 *
 * One caveat about that 401, worth knowing rather than working around: the client reaches this route
 * through `apiFetch`, which treats an unrecoverable 401 as an expired session and navigates to
 * `/login`. So the message below is a correct HTTP answer that no human reads on this surface — the
 * modal's error line never renders it, because the document is already unloading.
 */

// #region Field keys
/**
 * The wizard control each per-stage payload field is edited by.
 *
 * A Zod issue arrives with a POSITIONAL path — `["stages", 1, "unitPriceCents"]` — while the wizard
 * addresses its controls by name, so a raw joined path produces a 422 key no step rail knows about
 * and the form refuses a save while highlighting nothing. That is the same defect class as a control
 * that renders and does nothing (root CLAUDE.md §3 gate 11), pointing the other way.
 *
 * Only fields the wizard actually renders a control for are listed. Anything else falls through to
 * its joined path rather than being mapped onto the nearest-looking control: a message attached to
 * the wrong input is worse than one attached to none, because the reader corrects the wrong thing.
 */
const STAGE_FIELD_CONTROL: Readonly<Record<string, ProjectWizardField>> = {
	name: "stageName",
	description: "stageDescription",
	tasks: "stageTasks",
	skills: "stageSkills",
	requiresFiles: "stageRequiresFiles",
	allowedFileCategories: "stageAllowedFileTypes",
	allowedFileExtensions: "stageAllowedFileTypes",
	ndaOverride: "stageNdaOverride",
	dependsOnStageIndex: "stageDependsOn",
	parallel: "stageParallel",
	lagDays: "stageLagDays",
	durationMode: "stageDuration",
	durationDays: "stageDuration",
	dueDate: "stageDuration",
	unitPriceCents: "stageUnitPrice",
	seatLimit: "stageSeatLimit",
};

/** The control names the wizard knows, so a top-level field can be recognised as one of its own. */
const WIZARD_FIELDS: ReadonlySet<string> = new Set(ProjectWizardField.options);

/**
 * The control a Zod issue belongs to.
 *
 * `ndaDocumentId` resolves to the NDA control because the document is not a field of its own — it is
 * the half of the mode that only `custom` carries, and the wizard offers one control for the pair.
 * A role issue resolves to the single `roles` control for the same reason: the step edits the list,
 * not a numbered row of it.
 */
function wizardFieldFor(path: ReadonlyArray<PropertyKey>): string {
	const head = String(path[0] ?? "");
	if (head === "stages" && path.length >= 3) {
		return STAGE_FIELD_CONTROL[String(path[2])] ?? path.map(String).join(".");
	}
	if (head === "roles") return "roles";
	if (head === "ndaDocumentId") return "ndaMode";
	if (WIZARD_FIELDS.has(head)) return head;
	return path.map(String).join(".") || "form";
}
// #endregion

export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to create a project." },
				{ status: 401 },
			);
		}

		const raw = await ctx.req.json().catch(() => null);
		const parsed = CreateProjectSchema.safeParse(raw);
		if (!parsed.success) {
			// First issue per control wins: a field with three complaints gets the first one, because
			// the form shows one message per input and the rest would never be read.
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = wizardFieldFor(issue.path);
				if (!errors[key]) errors[key] = issue.message;
			}
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors },
				{ status: 422 },
			);
		}

		return toProjectsResponse(await ProjectBackendService.create(parsed.data, actor));
	},
});
