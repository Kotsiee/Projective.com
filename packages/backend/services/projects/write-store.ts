import {
	type BoardCard,
	type BoardPage,
	type BoardStageRef,
	buildBoardColumns,
	type ChatMessage,
	type CommitTicket,
	type CreateSubmission,
	formatTicketMoney,
	type MessageAttachment,
	type MessagePage,
	type MessageSender,
	type MoveTicket,
	type ProjectDetail,
	type ProjectFeedPayload,
	type ProjectOverview,
	type ProjectSetup,
	type ProjectSetupPatch,
	type ProjectSummary,
	reconcileSetup,
	type SendProjectMessage,
	stageCostCents,
	type StageSetup,
	type SubmissionListPage,
	type SubmissionTreeNode,
	type SubmissionUnit,
	type TicketIntensity,
	type TicketStageRef,
	ticketTotalCents,
	type UpdateProject,
	workloadIntensity,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";

/**
 * projects write store — the mutable, PER-PROCESS overlay the projects write path keeps while
 * `PROJECTS_BACKEND_LIVE` is off.
 *
 * ## It is not a database, and a restart loses everything
 *
 * This is an in-module `Map`, exactly like {@link ./draft-store.ts} and the catalogue session store
 * that preceded it. Nothing here is written to disk, nothing survives a server restart, and nothing
 * is shared between processes. It exists for one reason: a stub that returns `ok()` and mutates
 * nothing fails the only test that matters for a write — that the change is still there after the
 * browser reloads. With the gate off, this is what makes a ticket move, a renamed stage or a sent
 * message survive a full refresh.
 *
 * The live path replaces this file and nothing else. Every shape it stores is already the projection
 * the read returns, so the fat service's return values are identical either side of the gate.
 *
 * ## An OVERLAY, never a rewritten corpus
 *
 * The fixture modules beside this one are shared module state, derived deterministically from one
 * corpus. Mutating them in place would make one caller's edit everybody's — including the SSR render
 * of an unrelated request — and would quietly destroy the determinism the whole fixture layer is
 * built on. So this store holds PATCHES keyed by id, and the read path folds them over a freshly
 * derived page at the single point it returns one. The corpus is never touched.
 *
 * Each fold is applied only where the FIXTURE branch answered. With the gate on, a write goes to
 * Postgres and the read comes back from Postgres, so folding a stub patch over it would be applying
 * an edit twice.
 *
 * ## Scoped by owner
 *
 * Keyed by the acting identity the same way {@link ./draft-store.ts} keys drafts, so one developer's
 * simulated edits are not another session's. `""` collapses to a shared anonymous bucket rather than
 * being refused: a write route requires an identity, but a READ may legitimately arrive without one,
 * and a guest who cannot write simply sees an empty overlay.
 */

// #region Owner scoping
/**
 * The per-viewer bucket key.
 *
 * Both halves are carried because the same person acting personally and acting as a team is reading
 * two different feeds — the distinction {@link ReadActor} exists to draw, and the one a single-field
 * key would collapse.
 */
export function writeOwnerOf(actor?: ReadActor): string {
	return `${actor?.userId || "anon"}::${actor?.contextId || "personal"}`;
}
// #endregion

// #region Stored shapes
/** A project's accumulated configuration edits, plus the archive flag that is not a status. */
interface StoredSetup {
	/**
	 * The folded patch. Successive PATCHes accumulate here rather than replacing one another, so a
	 * form that saves one section does not blank the section saved a moment earlier.
	 */
	patch: ProjectSetupPatch;
	/**
	 * When the project was archived, or `null`.
	 *
	 * Held apart from `patch.status` deliberately: the `project_status` column carries an `archived`
	 * member and the Zod {@link ProjectStatus} does not, so writing it into the status field would
	 * produce a projection that fails its own schema. The archive is recorded as its own fact and the
	 * last real status is preserved.
	 */
	archivedAt: string | null;
}

/** One submission created through the stub path, with the scope facts the tree overlay needs. */
export interface StoredSubmission {
	unit: SubmissionUnit;
	stageId: string;
	/** The channel the submission was filed from; `null` when it was created in project scope. */
	channelId: string | null;
}

/** Everything one viewer has written, partitioned by the read that has to fold it back. */
interface OwnerBucket {
	/** Configuration edits, keyed by project slug. */
	setups: Map<string, StoredSetup>;
	/** Whole replacement cards, keyed by project id then ticket id. */
	cards: Map<string, Map<string, BoardCard>>;
	/** Sent messages, keyed by {@link channelKey}, oldest first. */
	messages: Map<string, ChatMessage[]>;
	/** Created submission units, keyed by project id, newest first. */
	submissions: Map<string, StoredSubmission[]>;
	/** Engagements this viewer created in stub mode, keyed by slug, newest first. */
	created: Map<string, StoredProject>;
}

/**
 * An engagement created through the stub path.
 *
 * The whole record rather than a patch: there is no fixture underneath it to fold over. Stored as a
 * {@link ProjectSetup} because that is the projection the owner's own surface reads, and because
 * `reconcileSetup` derives the ladder, the percentage and the gate from it — so a project drafted here
 * measures its own completeness by exactly the function that measures a live one's.
 */
interface StoredProject {
	id: string;
	setup: ProjectSetup;
	createdAt: number;
}

const buckets = new Map<string, OwnerBucket>();

/** The bucket for an owner, created on first write. */
function bucketFor(owner: string): OwnerBucket {
	const existing = buckets.get(owner);
	if (existing) return existing;
	const fresh: OwnerBucket = {
		setups: new Map(),
		cards: new Map(),
		messages: new Map(),
		submissions: new Map(),
		created: new Map(),
	};
	buckets.set(owner, fresh);
	return fresh;
}

/** The bucket for an owner, or `undefined` — the read path must not create one. */
function peekBucket(owner: string): OwnerBucket | undefined {
	return buckets.get(owner);
}

/**
 * The separator between the two halves of a composite key.
 *
 * A control character rather than a punctuation mark because a project id and a channel id are both
 * caller-supplied strings: any separator they could legally contain lets `a` + `b-c` and `a-b` + `c`
 * collide onto one key, which would serve one channel's messages into another.
 *
 * Built with {@link String.fromCharCode} rather than typed into the string literal. A raw NUL in a
 * source file makes it binary to git and invisible to `grep`, so the code around it stops appearing
 * in a diff and stops being reviewable — a defect this repository has shipped twice. This spelling
 * is plain ASCII on disk and the identical character at runtime.
 */
const KEY_SEPARATOR = String.fromCharCode(0);

/** The composite key one channel's messages are stored under. */
function channelKey(projectId: string, channelId: string): string {
	return `${projectId}${KEY_SEPARATOR}${channelId}`;
}

/**
 * Forget everything. Tests only — a suite that leaves state behind makes the NEXT test's result
 * depend on the order it ran in, which is the failure mode a shared module-level store invites.
 */
export function resetWriteStore(): void {
	buckets.clear();
}
// #endregion

// #region Setup writes
/**
 * Fold a configuration patch into a project's stored edits.
 *
 * `budget` and `rules` merge field-by-field for the same reason {@link reconcileSetup} does: a PATCH
 * that carries one changed rule must not blank the other seven. `stages` and `roles` REPLACE, because
 * the array the client sent is the whole list after its own create/update/remove reconciliation, and
 * merging two lists positionally would resurrect a row the owner deleted.
 */
export function mergeSetupPatch(
	owner: string,
	slug: string,
	patch: ProjectSetupPatch,
): ProjectSetupPatch {
	const bucket = bucketFor(owner);
	const current = bucket.setups.get(slug) ?? { patch: {}, archivedAt: null };
	const merged: ProjectSetupPatch = {
		...current.patch,
		...patch,
		budget: patch.budget || current.patch.budget
			? { ...current.patch.budget, ...patch.budget }
			: undefined,
		rules: patch.rules || current.patch.rules
			? { ...current.patch.rules, ...patch.rules }
			: undefined,
	};
	bucket.setups.set(slug, { ...current, patch: merged });
	return merged;
}

/**
 * Record a soft archive.
 *
 * Idempotent on purpose: archiving an already-archived project returns the ORIGINAL instant rather
 * than restamping it, so a double-press cannot rewrite when the decision was taken.
 */
export function recordProjectArchive(owner: string, slug: string, at: string): string {
	const bucket = bucketFor(owner);
	const current = bucket.setups.get(slug) ?? { patch: {}, archivedAt: null };
	const archivedAt = current.archivedAt ?? at;
	bucket.setups.set(slug, { ...current, archivedAt });
	return archivedAt;
}

/** When this viewer archived the project through the stub path, or `null`. */
export function storedArchivedAt(owner: string, slug: string): string | null {
	return peekBucket(owner)?.setups.get(slug)?.archivedAt ?? null;
}
// #endregion

// #region Ticket writes
/**
 * Store a whole card rather than a diff.
 *
 * A diff would have to be re-applied against a corpus that is re-derived on every read, so a field
 * the diff did not mention could change underneath it between two requests and the reader would see
 * half an edit. The card the service just computed is the answer it returned, so storing exactly that
 * makes the next read agree with the response by construction.
 */
export function putTicketCard(owner: string, projectId: string, card: BoardCard): void {
	const bucket = bucketFor(owner);
	const forProject = bucket.cards.get(projectId) ?? new Map<string, BoardCard>();
	forProject.set(card.id, card);
	bucket.cards.set(projectId, forProject);
}

/** The stored card for one ticket, or `undefined` — the write path's read-before-write. */
export function storedTicketCard(
	owner: string,
	projectId: string,
	ticketId: string,
): BoardCard | undefined {
	return peekBucket(owner)?.cards.get(projectId)?.get(ticketId);
}
// #endregion

// #region Message writes
/** Append a sent message to a channel's stored tail. */
export function appendChannelMessage(
	owner: string,
	projectId: string,
	channelId: string,
	message: ChatMessage,
): void {
	const bucket = bucketFor(owner);
	const key = channelKey(projectId, channelId);
	const existing = bucket.messages.get(key) ?? [];
	existing.push(message);
	bucket.messages.set(key, existing);
}

/** How many messages this viewer has sent into a channel — the id suffix a fresh one takes. */
export function sentMessageCount(owner: string, projectId: string, channelId: string): number {
	return peekBucket(owner)?.messages.get(channelKey(projectId, channelId))?.length ?? 0;
}
// #endregion

// #region Submission writes
/** Record a created submission unit against its stage. */
export function appendSubmission(
	owner: string,
	projectId: string,
	entry: StoredSubmission,
): void {
	const bucket = bucketFor(owner);
	const existing = bucket.submissions.get(projectId) ?? [];
	existing.unshift(entry);
	bucket.submissions.set(projectId, existing);
}

/**
 * Send a stored draft for review, in place.
 *
 * Returns the updated entry, or null when nothing in the store carries that id — which is what tells
 * the caller to insert instead. Matched on the unit's LAST path segment, the submission's own id, so
 * the stub reconciles the same way the live path does rather than on a title that may repeat.
 */
export function submitStoredSubmission(
	owner: string,
	projectId: string,
	submissionId: string,
	unit: SubmissionUnit,
): StoredSubmission | null {
	const entries = peekBucket(owner)?.submissions.get(projectId);
	if (!entries) return null;
	const index = entries.findIndex((e) => e.unit.path[e.unit.path.length - 1] === submissionId);
	if (index === -1) return null;
	const updated: StoredSubmission = { ...entries[index], unit };
	entries[index] = updated;
	return updated;
}

// #region Created engagements
/**
 * Record an engagement drafted through the stub path.
 *
 * Stub mode is the default (`PROJECTS_BACKEND_LIVE` ships off), and without this the create modal
 * returned a slug, navigated there, and rendered "Project not found" — the exact failure the live
 * path exists to fix, reproduced one layer up. So the stub persists too, per-process and
 * per-viewer, and the reads below fold it in.
 */
export function recordCreatedProject(
	owner: string,
	id: string,
	setup: ProjectSetup,
	createdAt: number,
): void {
	bucketFor(owner).created.set(setup.slug, { id, setup, createdAt });
}

/** An engagement this viewer drafted in stub mode, or `null`. */
export function storedCreatedProject(slug: string, actor?: ReadActor): ProjectSetup | null {
	return peekBucket(writeOwnerOf(actor))?.created.get(slug)?.setup ?? null;
}

/** Whether a slug names an engagement this viewer drafted in stub mode. */
export function isStoredCreated(slug: string, actor?: ReadActor): boolean {
	return peekBucket(writeOwnerOf(actor))?.created.has(slug) === true;
}

/**
 * Every engagement this viewer drafted, newest first.
 *
 * Ordered here rather than at the call site so the feed and any other consumer agree on what "newest"
 * means without each re-sorting a map's insertion order.
 */
export function storedCreatedProjects(actor?: ReadActor): { id: string; setup: ProjectSetup }[] {
	const bucket = peekBucket(writeOwnerOf(actor));
	if (!bucket) return [];
	return [...bucket.created.values()]
		.sort((a, b) => b.createdAt - a.createdAt)
		.map(({ id, setup }) => ({ id, setup }));
}
// #endregion

/** How many submissions this viewer has created in a project — the number a fresh unit takes. */
export function submissionCount(owner: string, projectId: string): number {
	return peekBucket(owner)?.submissions.get(projectId)?.length ?? 0;
}
// #endregion

// #region Read overlays
/**
 * Fold a project's stored edits over a derived {@link ProjectSetup}.
 *
 * {@link reconcileSetup} is what re-derives the ladder, the percentage and the gate, so the bar the
 * owner reads after a save is computed by exactly the code that computed it before one.
 */
export function overlaySetup(base: ProjectSetup, actor?: ReadActor): ProjectSetup {
	const bucket = peekBucket(writeOwnerOf(actor));
	const stored = bucket?.setups.get(base.slug);
	if (!stored) return base;
	// The archive travels with the patch. It was recorded and then read by nothing, so archiving a
	// project in stub mode returned "Project archived.", navigated the owner to the feed, and left it
	// listed and editable — a soft delete nobody could see had happened.
	return reconcileSetup(base, { ...stored.patch, archivedAt: stored.archivedAt });
}

/**
 * The setup projection for an engagement that exists ONLY in the store.
 *
 * Returns `null` when the slug names nothing this viewer created, which is what lets a caller try the
 * store first and fall through to the fixture corpus. Any later edits are folded on top, so a project
 * drafted and then configured reads back as configured rather than as it was named.
 */
export function createdSetup(slug: string, actor?: ReadActor): ProjectSetup | null {
	const owner = writeOwnerOf(actor);
	const bucket = peekBucket(owner);
	const record = bucket?.created.get(slug);
	if (!record) return null;
	const stored = bucket?.setups.get(slug);
	if (!stored) return record.setup;
	return reconcileSetup(record.setup, { ...stored.patch, archivedAt: stored.archivedAt });
}

/**
 * The sidebar/dispatcher projection for an engagement that exists ONLY in the store.
 *
 * Needed because the ROLE DISPATCHER at `/projects/[projectId]` decides which of the two surfaces to
 * render from `detail.viewerIsClient`, and a null detail defaults it to `false` — so without this a
 * freshly drafted project sent its own creator to the MEMBER dashboard, which then rendered "Project
 * not found" over a project that had just been created successfully.
 *
 * NOTHING IS FABRICATED. Facts the store does not hold stay absent rather than being invented: no
 * members, no teams, no DMs, no banner, no client, and an owner named only as "You" — a project with
 * an unnamed owner is legible, one attributed to a person who does not exist is a false claim. The
 * stage rooms ARE listed, because on the live path `create_project` opens them in the same
 * transaction, so their presence is the truth on both branches rather than a stub convenience.
 */
export function createdDetail(slug: string, actor?: ReadActor): ProjectDetail | null {
	const owner = writeOwnerOf(actor);
	const record = peekBucket(owner)?.created.get(slug);
	if (!record) return null;
	const setup = createdSetup(slug, actor) ?? record.setup;

	return {
		id: record.id,
		slug: setup.slug,
		title: setup.title,
		// A modal-created project is never a service: `kind` is derived from `source_blueprint_id`,
		// which only an instantiated blueprint carries.
		kind: "project",
		format: setup.format,
		status: setup.status,
		typeLabel: TYPE_LABELS[setup.format],
		description: setup.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(
			0,
			2000,
		),
		viewerRole: "owner",
		// The creator IS the client — they commissioned it. This is what routes the dispatcher to the
		// setup surface rather than to somebody else's dashboard.
		viewerIsClient: true,
		scopeType: actor?.contextType ?? "personal",
		scopeLabel: actor?.contextId ? "Workspace" : "Personal",
		starred: false,
		owner: { name: "You", avatar: null, handle: null },
		client: null,
		bannerImage: null,
		members: [],
		// NO CHANNELS, and that is the honest answer rather than a missing feature.
		//
		// The live path opens each stage's room inside `create_project`, so a live-created project's
		// tree is real and every room in it resolves. Nothing provisions a room on THIS path, so
		// listing one would render a channel the sidebar makes clickable and whose every read — the
		// message page, the board, files, members — answers 404. A control that renders must do
		// something (root CLAUDE.md §3 gate 11); mimicking the live tree's appearance without its
		// substance is worse than differing from it visibly.
		channels: { general: [], stages: [], teams: [], dms: [] },
	};
}

/**
 * The FEED row for an engagement that exists only in the store.
 *
 * Same restraint as {@link createdDetail}: counts that nothing has produced are zero rather than
 * plausible, and the owner is named "You" rather than fabricated. `scopeId` mirrors the READ path's
 * `scopeOf`, which reports the user's own id for a personal engagement — so the lane's scope filter
 * groups a drafted project exactly where it groups a live one.
 */
export function createdSummary(slug: string, actor?: ReadActor): ProjectSummary | null {
	const owner = writeOwnerOf(actor);
	const record = peekBucket(owner)?.created.get(slug);
	if (!record) return null;
	const setup = createdSetup(slug, actor) ?? record.setup;
	if (setup.archivedAt) return null;

	const scopeType = actor?.contextType ?? "personal";
	return {
		id: record.id,
		slug: setup.slug,
		title: setup.title,
		kind: "project",
		format: setup.format,
		status: setup.status,
		viewerRole: "owner",
		scopeType,
		scopeId: (scopeType === "personal" ? actor?.userId : actor?.contextId) ?? "",
		scopeLabel: scopeType === "personal" ? "Personal" : "Workspace",
		owner: { name: "You", avatar: null, handle: null },
		// Nobody is on the other side of a project that was named a moment ago.
		counterparty: null,
		// Client-architected, not instantiated from one of the actor's own services.
		serviceId: null,
		unread: false,
		starred: false,
		// `null` rather than 0 for a format with no stage run at all — the meter is absent, not empty.
		completedStages: setup.stages.length > 0 ? 0 : null,
		totalStages: setup.stages.length > 0 ? setup.stages.length : null,
		activity: null,
		// The record's own creation instant, mirroring the live read's `last_activity_at ?? updated_at`
		// — a drafted project's creation IS its last activity.
		updatedAt: new Date(record.createdAt).toISOString(),
		budgetLabel: setup.budget.amountCents === null ? null : formatCreatedBudget(setup.budget),
	};
}

/**
 * The card's pre-formatted budget.
 *
 * Pre-formatted server-side for the same reason every other label on this row is: a string assembled
 * in the browser is a different string from the one SSR sent, and the two disagreeing is a hydration
 * mismatch on the face of the card.
 */
function formatCreatedBudget(budget: ProjectSetup["budget"]): string | null {
	if (budget.amountCents === null) return null;
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: budget.currency,
			maximumFractionDigits: 0,
		}).format(budget.amountCents / 100);
	} catch {
		// An unknown currency code throws rather than degrading. No label beats a wrong one.
		return null;
	}
}

/** Engagement-format display labels, so the sidebar names a format the way the rest of the app does. */
const TYPE_LABELS: Record<ProjectSetup["format"], string> = {
	pipeline: "Pipeline project",
	one_off: "One-off project",
	session: "Session service",
};

/**
 * Whether this viewer has archived the project — the predicate every stub read filters on.
 *
 * A single named question rather than a `storedArchivedAt(...) !== null` at each call site, because
 * "is it archived" is asked by the feed, the item read and the overview, and three copies of the same
 * comparison is three chances for one of them to keep listing a row the others have dropped.
 */
export function isStoredArchived(slug: string, actor?: ReadActor): boolean {
	return storedArchivedAt(writeOwnerOf(actor), slug) !== null;
}

/**
 * Fold a stored edit over a feed row, and report whether the row still belongs in the feed.
 *
 * Returns `null` for an archived project. The three fields folded are the three the row renders and
 * the setup form can change; everything else on a summary is derived from data this store does not
 * hold.
 */
export function overlaySummary(
	summary: ProjectSummary,
	actor?: ReadActor,
): ProjectSummary | null {
	const stored = peekBucket(writeOwnerOf(actor))?.setups.get(summary.slug);
	if (!stored) return summary;
	if (stored.archivedAt) return null;
	const { patch } = stored;
	return {
		...summary,
		title: patch.title ?? summary.title,
		format: patch.format ?? summary.format,
		status: patch.status ?? summary.status,
	};
}

/**
 * Fold stored edits over a whole feed page.
 *
 * `count` is recomputed from what survives rather than carried through: a count that still includes
 * an archived project is the surface telling the reader something is there and then not drawing it.
 * The group buckets are re-counted the same way, for the same reason.
 */
export function overlayFeed(page: ProjectFeedPayload, actor?: ReadActor): ProjectFeedPayload {
	const items: ProjectSummary[] = [];
	for (const item of page.items) {
		const folded = overlaySummary(item, actor);
		if (folded) items.push(folded);
	}

	// Engagements this viewer DRAFTED, newest first, ahead of the corpus. They have no fixture row to
	// fold over, so folding alone would leave a created project absent from the very list the create
	// button sits on — the surface would report success and show nothing.
	const drafted: ProjectSummary[] = [];
	for (const { setup } of storedCreatedProjects(actor)) {
		const row = createdSummary(setup.slug, actor);
		if (row) drafted.push(row);
	}

	if (items.length === page.items.length && drafted.length === 0) return page;
	const next = [...drafted, ...items];
	return {
		...page,
		items: next,
		// Recomputed from what actually survives rather than adjusted by a delta: a count that still
		// includes an archived project, or omits a drafted one, is the surface disagreeing with itself.
		count: next.length,
		groups: page.groups.map((group) => ({
			...group,
			count: next.filter((item) => item.scopeId === group.scopeId).length,
		})),
	};
}

/** Fold a stored edit's identity fields over a derived {@link ProjectOverview}. */
export function overlayOverview(
	overview: ProjectOverview,
	slug: string,
	actor?: ReadActor,
): ProjectOverview {
	const stored = peekBucket(writeOwnerOf(actor))?.setups.get(slug);
	if (!stored) return overview;
	const { patch } = stored;
	return {
		...overview,
		hero: {
			...overview.hero,
			title: patch.title ?? overview.hero.title,
			status: patch.status ?? overview.hero.status,
		},
	};
}

/**
 * Fold the identity fields of a stored edit over a derived {@link ProjectDetail}.
 *
 * Deliberately narrow: title, description and status are the three configuration fields the sidebar
 * actually renders, and they map across without interpretation. The stage TREE is not folded here —
 * a stage's channel, its activity signal and its unread state are derived facts with no counterpart
 * in the setup projection, and inventing them would put a room in the tree that no message can reach
 * (root CLAUDE.md §3 gate 11). New stages surface on the board, where a stage is a column rather than
 * a room.
 */
export function overlayDetail(detail: ProjectDetail, actor?: ReadActor): ProjectDetail {
	const stored = peekBucket(writeOwnerOf(actor))?.setups.get(detail.slug);
	if (!stored) return detail;
	const { patch } = stored;
	return {
		...detail,
		title: patch.title ?? detail.title,
		description: patch.description ?? detail.description,
		status: patch.status ?? detail.status,
	};
}

/**
 * Fold stored tickets and stages over a derived {@link BoardPage}.
 *
 * Three things happen, in this order, and the order is what makes a MOVE work rather than merely a
 * rename. Stored cards replace their fixture twin; a card whose stored stage no longer belongs to
 * this board's scope is dropped; and a card the fixture excluded — because it was moved INTO this
 * stage since — is appended. A fold that only replaced in place would leave a moved ticket in its old
 * column on a stage-scoped board and absent from its new one.
 */
export function overlayBoardPage(page: BoardPage, actor?: ReadActor): BoardPage {
	const bucket = peekBucket(writeOwnerOf(actor));
	if (!bucket) return page;
	const stored = bucket.cards.get(page.projectId);
	const setup = bucket.setups.get(page.projectId)?.patch;
	if (!stored?.size && !setup?.stages?.length) return page;

	// A stage board is addressed by its channel id, and the fixture corpus mints a stage and its room
	// with the SAME id (`stage-N`), which is also what `findBoardPage` matches on. Scope is therefore a
	// stage-id comparison; a card in the New backlog carries no stage and is correctly excluded.
	const inScope = (card: BoardCard): boolean =>
		page.scope === "project" || card.stageId === page.channelId;

	const cards: BoardCard[] = [];
	const seen = new Set<string>();
	for (const card of page.cards) {
		seen.add(card.id);
		const resolved = stored?.get(card.id) ?? card;
		if (inScope(resolved)) cards.push(resolved);
	}
	if (stored) {
		for (const [id, card] of stored) {
			if (seen.has(id)) continue;
			if (inScope(card)) cards.push(card);
		}
	}

	const stages = overlayStages(page.stages, setup?.stages, cards);
	return {
		...page,
		cards,
		total: cards.length,
		stages,
		// Recomputed rather than carried: a column list built before a stage was added would render a
		// board whose stage is in the inspector and nowhere on the canvas.
		columns: buildBoardColumns(stages, page.view, page.kind),
	};
}

/**
 * Reconcile the board's stage descriptors against the setup form's stage list.
 *
 * A stage the form renamed or re-priced updates in place; a stage the form ADDED is appended with
 * neutral operational facts, because a stage nobody has staffed has no roster, no routed tickets and
 * no live cap. `categoryWeight` is `1` for the same reason the live board reads it as `1` — the
 * column does not exist, and $W_i$ computed from an invented weight is plausible and wrong (root
 * CLAUDE.md §8 Decision #64(b)).
 */
function overlayStages(
	current: readonly BoardStageRef[],
	edited: readonly Partial<StageSetup>[] | undefined,
	cards: readonly BoardCard[],
): BoardStageRef[] {
	if (!edited?.length) return [...current];
	const byId = new Map(current.map((stage) => [stage.id, stage]));
	const out: BoardStageRef[] = [];
	edited.forEach((stage, index) => {
		const id = stage.id;
		if (!id) return;
		const existing = byId.get(id);
		const ticketCount = cards.filter((card) => card.stageId === id).length;
		if (existing) {
			out.push({
				...existing,
				name: stage.name ?? existing.name,
				order: stage.order ?? existing.order,
				description: stage.description ?? existing.description,
				unitPriceCents: stage.unitPriceCents !== undefined
					? stage.unitPriceCents
					: existing.unitPriceCents,
				ticketCount,
			});
			return;
		}
		out.push({
			id,
			name: stage.name ?? `Stage ${index + 1}`,
			order: stage.order ?? index,
			status: "draft",
			locked: false,
			description: stage.description ?? "",
			unitPriceCents: stage.unitPriceCents ?? null,
			categoryWeight: 1,
			members: [],
			ticketCount,
			assignmentMode: "open_pull",
			maxConcurrentIntensity: null,
		});
	});
	// A stage the edit did not mention is still a stage. Dropping it would delete a column because a
	// form section happened not to send it, which is not what a PATCH means.
	for (const stage of current) {
		if (out.some((s) => s.id === stage.id)) continue;
		out.push(stage);
	}
	return out.sort((a, b) => a.order - b.order);
}

/**
 * Append this viewer's sent messages to a derived {@link MessagePage}.
 *
 * Only onto the LATEST page. A sent message is by definition newer than everything in the channel, so
 * folding it into an older page requested by the scroll-up cursor would insert it in the middle of a
 * history it postdates.
 */
export function overlayMessagePage(
	page: MessagePage,
	projectId: string,
	isLatestPage: boolean,
	actor?: ReadActor,
): MessagePage {
	if (!isLatestPage) return page;
	const sent = peekBucket(writeOwnerOf(actor))?.messages.get(channelKey(projectId, page.channelId));
	if (!sent?.length) return page;
	const fresh = sent.filter((message) => !page.messages.some((m) => m.id === message.id));
	if (fresh.length === 0) return page;
	return {
		...page,
		messages: [...page.messages, ...fresh],
		total: page.total + fresh.length,
	};
}

/**
 * Surface this viewer's created submissions on a derived {@link SubmissionListPage}.
 *
 * The units are prepended as ROOT nodes of the tree rather than nested under their stage's submitter
 * branch, and that is a deliberate limit rather than an oversight: the fixture hierarchy is rebuilt
 * from a private node structure on every read, so a stored unit has no stable ancestor to attach to
 * and guessing one would put a submission under the wrong freelancer. A root node is navigable, is
 * truthfully labelled with its stage, and the live path — where a submission has a real parent —
 * removes the question entirely.
 *
 * `activeUnit` is filled when the requested path resolves to one of these units, so the review
 * workspace opens on a submission that was just created rather than reporting nothing there.
 */
export function overlaySubmissionPage(
	page: SubmissionListPage,
	actor?: ReadActor,
): SubmissionListPage {
	const created = peekBucket(writeOwnerOf(actor))?.submissions.get(page.projectId);
	if (!created?.length) return page;

	const scoped = created.filter((entry) =>
		page.scope === "project" || entry.channelId === null || entry.channelId === page.channelId
	);
	if (scoped.length === 0) return page;

	const nodes: SubmissionTreeNode[] = scoped
		.filter((entry) => !page.tree.some((node) => node.segment === entry.unit.path[0]))
		.map((entry) => ({
			segment: entry.unit.path[0],
			kind: "unit" as const,
			label: entry.unit.name,
			sublabel: entry.unit.stageName,
			status: entry.unit.status,
			fileCount: entry.unit.fileCount,
			children: [],
		}));

	const active = page.path.length === 1
		? scoped.find((entry) => entry.unit.path[0] === page.path[0])?.unit ?? null
		: null;

	return {
		...page,
		tree: [...nodes, ...page.tree],
		activeUnit: active ?? page.activeUnit,
	};
}
// #endregion

// #region Stub projections
/**
 * The shapes a stub write returns, built from what the caller sent plus what the corpus already
 * knows.
 *
 * They are PURE — every fixture value they need is passed in — so this module still reads no corpus
 * of its own and the service stays the one place a lookup happens. That matters beyond tidiness:
 * these builders decide what a written row LOOKS like, and a builder that could reach the corpus
 * could also silently disagree with the page the service fetched a moment earlier.
 *
 * The money and capacity figures are recomputed here from the SSOT's own helpers rather than taken
 * from the payload. A price the client sent is a price the client chose, and a ticket whose cost was
 * typed rather than derived is exactly what root CLAUDE.md §8 Decision #64 removed.
 */

/**
 * A monotonic source of ids for rows this process created.
 *
 * Monotonic rather than positional. The obvious alternative — naming a new stage after its index —
 * reuses an id the moment the owner deletes one stage and adds another, and every ticket pointing at
 * the old one silently follows the new one instead. An id is never reclaimed for the life of the
 * process, which is the only guarantee that makes a reference to it safe.
 */
let sequence = 0;

/** Mint an id no row in this process has held before. */
function mintId(prefix: string): string {
	sequence += 1;
	return `${prefix}-${sequence}`;
}

/**
 * Turn the PATCH body into the store's patch shape, resolving each partial row against the base.
 *
 * The wire lets a stage arrive three ways and the difference is entirely in its id: absent or
 * `stage-draft-…` is a CREATE, a known id is an UPDATE, and a base row missing from the array is a
 * REMOVE — which needs no branch here, because the array the client sent IS the list after their own
 * reconciliation and it simply omits the removed row.
 *
 * An UPDATE merges over the base row rather than replacing it, so a section that sends only a new
 * price does not blank the scope prose beside it.
 */
export function setupPatchFrom(input: UpdateProject, base: ProjectSetup): ProjectSetupPatch {
	const patch: ProjectSetupPatch = {};
	if (input.title !== undefined) patch.title = input.title;
	if (input.format !== undefined) patch.format = input.format;
	if (input.structure !== undefined) patch.structure = input.structure;
	if (input.sessionKind !== undefined) patch.sessionKind = input.sessionKind;
	if (input.description !== undefined) patch.description = input.description;
	if (input.status !== undefined) patch.status = input.status;
	if (input.budget !== undefined) patch.budget = input.budget;
	if (input.rules !== undefined) patch.rules = input.rules;

	if (input.stages) {
		const byId = new Map(base.stages.map((stage) => [stage.id, stage]));
		patch.stages = input.stages.map((stage, index) => {
			const existing = stage.id ? byId.get(stage.id) : undefined;
			return {
				id: existing?.id ?? mintId("stage"),
				name: stage.name ?? existing?.name ?? `Stage ${index + 1}`,
				order: index,
				description: stage.description ?? existing?.description ?? "",
				unitPriceCents: stage.unitPriceCents !== undefined
					? stage.unitPriceCents
					: existing?.unitPriceCents ?? null,
				milestone: stage.milestone ?? existing?.milestone ?? "",
				skills: stage.skills ?? existing?.skills ?? [],
			};
		});
	}

	if (input.roles) {
		const byId = new Map(base.roles.map((role) => [role.id, role]));
		patch.roles = input.roles.map((role, index) => {
			const existing = role.id ? byId.get(role.id) : undefined;
			return {
				id: existing?.id ?? mintId("role"),
				name: role.name ?? existing?.name ?? `Role ${index + 1}`,
				skills: role.skills ?? existing?.skills ?? [],
				budgetCents: role.budgetCents !== undefined
					? role.budgetCents
					: existing?.budgetCents ?? null,
			};
		});
	}

	return patch;
}

/** Mint the server-side id a stub-committed ticket carries. */
export function mintTicketId(): string {
	return mintId("ticket");
}

/** Pre-format a due date the way the board does, so a stub card and a fixture card read alike. */
function dueLabelOf(iso: string | null): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Pre-format an update stamp for the card footer. */
function dateLabelOf(now: number): string {
	return new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Resolve the ticket's stage refs against the board's own stages.
 *
 * The unit price is read from the BOARD stage, never from the payload: it is the stage's rate, the
 * client does not own it, and accepting the number they sent would let a ticket be priced at
 * whatever its composer felt like. The per-stage intensity falls back to the ticket's own, which is
 * what "default" means on that control — a stage the owner never overrode tracks the ticket.
 */
function resolveStageRefs(
	refs: readonly TicketStageRef[],
	stages: readonly BoardStageRef[],
	ticketIntensity: TicketIntensity,
): TicketStageRef[] {
	const byId = new Map(stages.map((stage) => [stage.id, stage]));
	return refs.map((ref, index) => {
		const stage = byId.get(ref.stageId);
		const intensity = ref.intensity ?? ticketIntensity;
		const unitPriceCents = stage?.unitPriceCents ?? null;
		return {
			...ref,
			name: stage?.name ?? ref.name,
			order: index,
			status: stage?.status ?? ref.status,
			intensity,
			unitPriceCents,
			costCents: stageCostCents(unitPriceCents, intensity),
		};
	});
}

/**
 * The capacity a ticket consumes, summed across its stages.
 *
 * `categoryWeight` comes from the stage and is `1` wherever no column backs it — the neutral value
 * the live board also reads (root CLAUDE.md §8 Decision #64(b)). A weight invented to look plausible
 * would make $W_i$ plausible and wrong, which is worse than obviously neutral.
 */
function workloadOf(
	refs: readonly TicketStageRef[],
	stages: readonly BoardStageRef[],
): number {
	const byId = new Map(stages.map((stage) => [stage.id, stage]));
	const total = refs.reduce(
		(sum, ref) =>
			sum + workloadIntensity(byId.get(ref.stageId)?.categoryWeight ?? 1, ref.intensity),
		0,
	);
	return Math.round(total * 100) / 100;
}

/**
 * Build the card a committed ticket becomes.
 *
 * `previous` carries the facts a commit does not own. Assignee, escrow, payments, history and
 * submissions are outcomes of work and of money movement, so editing a ticket's brief must not
 * silently clear who claimed it or what has been paid — and a stub that reset them would show the
 * owner an unclaimed, unpaid ticket the moment they fixed a typo in its title.
 */
export function buildStubCard(
	input: CommitTicket,
	stages: readonly BoardStageRef[],
	previous: BoardCard | undefined,
	id: string,
	now: number,
): BoardCard {
	const refs = resolveStageRefs(input.stages, stages, input.intensity);
	const budgetCents = ticketTotalCents(refs);
	const description = input.description.trim();
	const tasks = input.tasks;
	return {
		id,
		title: input.title,
		description: description.length > 0 ? input.description : null,
		hasDescription: description.length > 0,
		status: input.status,
		stageId: input.stageId,
		assignee: previous?.assignee ?? null,
		owner: previous?.owner ?? null,
		contributors: previous?.contributors ?? [],
		// Escrow is moved by `trg_ticket_escrow_sync` on the live path and by nothing at all here. A
		// stub that flipped these would report money as held that no ledger has a record of.
		claimed: previous?.claimed ?? false,
		escrowHeld: previous?.escrowHeld ?? false,
		priority: input.priority,
		intensity: input.intensity,
		workload: workloadOf(refs, stages),
		dueDate: input.dueDate,
		dueLabel: dueLabelOf(input.dueDate),
		budgetCents,
		budgetLabel: budgetCents === null ? null : formatTicketMoney(budgetCents),
		activity: previous?.activity ?? null,
		frozen: previous?.frozen ?? false,
		commentCount: previous?.commentCount ?? 0,
		attachmentCount: input.attachmentIds.length || (previous?.attachmentCount ?? 0),
		checklistDone: tasks.filter((task) => task.done).length,
		checklistTotal: tasks.length,
		stages: refs,
		tasks: [...tasks],
		attachments: previous?.attachments ?? [],
		history: previous?.history ?? [],
		submissions: previous?.submissions ?? [],
		submissionFiles: previous?.submissionFiles ?? [],
		payments: previous?.payments ?? [],
		unreadCount: previous?.unreadCount ?? 0,
		updatedAt: new Date(now).toISOString(),
		dateLabel: dateLabelOf(now),
		sortOrder: previous?.sortOrder ?? 0,
	};
}

/**
 * Apply a board drag to a card.
 *
 * `sortOrder` is honoured only in the backlog lane, mirroring `fn_ticket_ordering_guard`, which
 * RAISES when it changes anywhere else. The stub keeps the same rule rather than a looser one: a
 * drag that reorders here and is refused live is a drag whose result disappears the day the gate
 * flips, which is the harder bug to find.
 */
export function movedStubCard(card: BoardCard, input: MoveTicket, now: number): BoardCard {
	return {
		...card,
		status: input.status,
		stageId: input.stageId,
		sortOrder: input.status === "backlog" && input.sortOrder !== null
			? input.sortOrder
			: card.sortOrder,
		updatedAt: new Date(now).toISOString(),
		dateLabel: dateLabelOf(now),
	};
}

/** Pre-format the hover clock the feed reveals, matching the fixture corpus's own formatting. */
function clockLabel(now: number): string {
	return new Date(now).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
}

/**
 * Build the message a send becomes.
 *
 * The sender is passed in rather than constructed, because the corpus already has an identity for
 * the acting viewer and minting a second one would put two different faces on one person's messages
 * within a single channel.
 *
 * Attachments arrive as `files.items` ids — the bytes went through the upload handshake before this
 * call — and the corpus has no row to resolve them against, so the ids are carried as generic file
 * tiles rather than rendered as images whose dimensions would have to be invented.
 */
export function buildStubMessage(
	input: SendProjectMessage,
	sender: MessageSender,
	ordinal: number,
	now: number,
): ChatMessage {
	const attachments: MessageAttachment[] = input.attachmentIds.map((id, index) => ({
		id,
		kind: "file",
		url: `/api/files/${id}`,
		name: `Attachment ${index + 1}`,
		ext: "",
		width: null,
		height: null,
	}));
	return {
		id: `sent-${input.channelId}-${ordinal}`,
		type: "user",
		createdAt: new Date(now).toISOString(),
		timeLabel: clockLabel(now),
		dayLabel: "Today",
		sender,
		isOwn: true,
		text: input.text,
		attachments,
		audio: input.audio,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
	};
}

/**
 * Build the unit a created submission becomes.
 *
 * `status` follows `submit` exactly: a draft is editable and makes no delivery claim, while
 * `pending_review` starts the reviewer's clock. Conflating the two would tell a client that work is
 * waiting on them which the freelancer has not finished.
 */
export function buildStubSubmissionUnit(
	input: CreateSubmission,
	submitter: MessageSender,
	stageName: string | null,
	ordinal: number,
	now: number,
): SubmissionUnit {
	return {
		path: [`submission-${ordinal}`],
		name: input.title,
		kind: input.ticketId ? "ticket" : "custom",
		status: input.submit ? "pending_review" : "draft",
		submitter,
		stageId: input.stageId,
		stageName,
		ticketId: input.ticketId,
		ticketTitle: null,
		createdAt: new Date(now).toISOString(),
		dateLabel: dateLabelOf(now),
		fileCount: input.fileIds.length,
		noteCount: 0,
	};
}
// #endregion
