import type { z } from "zod";
import { deleteProjects, getProjects, patchProjects, postProjects } from "./api.ts";
import { toSearchParams } from "./projects-state.ts";
import type { ProjectFeedParams } from "./projects-state.ts";
import { CreateProjectSchema, ndaDocumentFor } from "../types/projects-types.ts";
import type {
	ArchiveProject,
	CreatedProject,
	CreateProject,
	ProjectDetail,
	ProjectFeedPayload,
	ProjectSetup,
	ProjectSummary,
	UpdateProject,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * ProjectSidebarService — the THIN client controller for the `/projects` middle-nav feed.
 *
 * A dumb object of named methods; each just builds a query string (or JSON body) and forwards to a
 * `/api/projects/*` route, returning a soft {@link ProjectsResult}. No fixtures, no query logic, no
 * scattered `fetch` — the feed island calls these for every client-side refinement (scope switch,
 * facet change, search) while the fat {@link ProjectBackendService} owns all
 * filtering/sorting/grouping (mirrors `ExploreService`).
 */

// #region Wire normalisation
/**
 * A stage's accepted extensions, in the one form a comparison can ever succeed against.
 *
 * The field asks for `psd` and a person types `.PSD`. Both describe the same restriction and only one
 * of them will equal a filename's suffix — and the mismatch does not fail loudly: the column stores
 * what it was given, the submission check compares two strings that differ by a dot, and the rule
 * silently refuses every file it was written to allow.
 *
 * It lives on the write boundary rather than inside either caller because BOTH write paths cross it
 * — the wizard's create and the setup form's save — and a stage restricted at creation and a stage
 * restricted afterwards have to be stored identically or the same list means two things. Values are
 * lower-cased, de-dotted and de-duplicated; an entry left empty by that is dropped rather than sent,
 * since `min(1)` would refuse it with a field path instead of a sentence.
 */
export function normalisedExtensions(raw: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const entry of raw) {
		const value = entry.trim().replace(/^\.+/, "").toLowerCase();
		if (value.length > 0) seen.add(value);
	}
	return [...seen];
}
// #endregion

// #region Create payload
/**
 * What a caller may hand {@link ProjectSidebarService.create}.
 *
 * The schema's INPUT type, not its output: every wizard field carries a default, so a step the author
 * never opened has nothing to send and `create` is what fills it in. Typing this as the output would
 * force every call site to restate eleven defaults it has no opinion about, and the first one to get
 * a default wrong would be writing a term the author never chose.
 */
export type CreateProjectInput = z.input<typeof CreateProjectSchema>;

/**
 * Fill in every default, resolve the one field pair the database refuses to store inconsistently, and
 * put every stage's submission filter into its comparable form ({@link normalisedExtensions}).
 *
 * `nda_document_id` is permitted only alongside `nda_mode = 'custom'` (`ck_projects_nda_document`),
 * so a wizard that collected a document and then switched the mode back must not send the reference
 * it no longer uses — the derivation is {@link ndaDocumentFor}'s, called here rather than restated,
 * so the client and the fat service reach the same answer.
 *
 * The deadline-bonus/format pair (`ck_projects_deadline_bonus_format`) is deliberately NOT resolved
 * here: `format` is the author's `ProjectCreateFormat`, which is the wizard's vocabulary rather than
 * the column's, and mapping one onto the other is `createFormatToColumns`' job on the server. A
 * client that guessed at the mapping would be deciding a stored value from a vocabulary it does not
 * own.
 */
function normaliseCreate(input: CreateProjectInput): ProjectsResult<CreateProject> {
	const parsed = CreateProjectSchema.safeParse(input);
	if (!parsed.success) {
		const errors: Record<string, string> = {};
		for (const issue of parsed.error.issues) {
			const path = issue.path.join(".") || "payload";
			if (!(path in errors)) errors[path] = issue.message;
		}
		return {
			ok: false,
			message: parsed.error.issues[0]?.message ?? "That project could not be created.",
			errors,
		};
	}
	const payload = parsed.data;
	return {
		ok: true,
		data: {
			...payload,
			ndaDocumentId: ndaDocumentFor(payload.ndaMode, payload.ndaDocumentId),
			stages: payload.stages.map((stage) => ({
				...stage,
				allowedFileExtensions: normalisedExtensions(stage.allowedFileExtensions),
			})),
		},
	};
}
// #endregion

export const ProjectSidebarService = {
	/** Fetch the context-scoped feed (rows + groups + scope/service matrices) for a param set. */
	list(params: ProjectFeedParams): Promise<ProjectsResult<ProjectFeedPayload>> {
		const qs = toSearchParams(params).toString();
		return getProjects<ProjectFeedPayload>(`/api/projects/list${qs ? `?${qs}` : ""}`);
	},

	/** Look up a single engagement by slug (deep-link prefetch / row focus). */
	item(slug: string): Promise<ProjectsResult<{ item: ProjectSummary }>> {
		return getProjects<{ item: ProjectSummary }>(
			`/api/projects/item?slug=${encodeURIComponent(slug)}`,
		);
	},

	/** Fetch the deep single-engagement projection for the Project Details sidebar. */
	detail(slug: string): Promise<ProjectsResult<{ detail: ProjectDetail }>> {
		return getProjects<{ detail: ProjectDetail }>(
			`/api/projects/detail?slug=${encodeURIComponent(slug)}`,
		);
	},

	/**
	 * Create a new engagement from the wizard payload.
	 *
	 * The body is completed through the Zod SSOT before it goes out, so what reaches the route is the
	 * WHOLE shape — currency, visibility, the engagement terms, the NDA pair and every per-stage
	 * field — rather than whichever subset the wizard step the author stopped on happened to hold. A
	 * partial body is not a smaller write: the route's own parse would fill the gaps with the same
	 * defaults, so the only thing a client that sent less would achieve is two places to disagree
	 * about what an unanswered field means.
	 *
	 * A body the schema refuses never leaves the browser. It comes back as a soft result carrying the
	 * offending field paths, because the wizard can point at the control while it is still on screen
	 * and a 422 from the route can only name a path after the modal has already reported a failure.
	 */
	async create(payload: CreateProjectInput): Promise<ProjectsResult<CreatedProject>> {
		const normalised = normaliseCreate(payload);
		if (!normalised.ok || !normalised.data) {
			return { ok: false, message: normalised.message, errors: normalised.errors };
		}
		return await postProjects<CreatedProject>("/api/projects/create", normalised.data);
	},

	/**
	 * Fetch the owner's editable configuration and its derived setup ladder.
	 *
	 * A separate read from {@link detail} because the two answer different questions: detail is the
	 * sidebar's showcase projection and carries no price, role or rule, so a progress bar built on it
	 * could only ever count a title.
	 */
	setup(slug: string): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return getProjects<{ setup: ProjectSetup }>(
			`/api/projects/setup?slug=${encodeURIComponent(slug)}`,
		);
	},

	/**
	 * Save an edit to the configuration.
	 *
	 * The response carries the RE-DERIVED setup, not an acknowledgement: `completeness`,
	 * `previewReady` and the step ladder are server-computed, so the form adopts what came back as its
	 * new clean baseline rather than re-deriving them beside a number it did not produce.
	 */
	update(slug: string, patch: UpdateProject): Promise<ProjectsResult<{ setup: ProjectSetup }>> {
		return patchProjects<{ setup: ProjectSetup }>(
			`/api/projects/${encodeURIComponent(slug)}`,
			patch,
		);
	},

	/**
	 * Archive an engagement. A soft archive — the project leaves circulation, the row stays (root
	 * CLAUDE.md §5) — which is why the caller gets back the moment it happened rather than a bare
	 * confirmation.
	 */
	archive(
		slug: string,
		body: ArchiveProject = {},
	): Promise<ProjectsResult<{ slug: string; archivedAt: string }>> {
		return deleteProjects<{ slug: string; archivedAt: string }>(
			`/api/projects/${encodeURIComponent(slug)}`,
			body,
		);
	},
};

export type { ProjectDetail, ProjectFeedPayload, ProjectSetup, ProjectSummary };
