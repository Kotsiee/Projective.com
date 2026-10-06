import { isSlug, mintSlug } from "@projective/types/slugs";
import { SLUG_MAX_ATTEMPTS } from "../../core/slug-retry.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProjectsBackendLive } from "../../core/supabase.ts";
import {
	cachedRead,
	cacheKey,
	invalidatePrefix,
	projectsReadCache,
	tenantPrefix,
} from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import { fetchProjectBySlug, fetchProjectRows, scopesFromRows } from "./live-queries.ts";
import { fetchBoardPage, fetchTicketLocation } from "./live-board.ts";
import { fetchProjectDetail } from "./live-detail.ts";
import { fetchFilePage } from "./live-files.ts";
import {
	fetchDeclinedInvitations,
	fetchMemberRoster as fetchLiveMemberRoster,
} from "./live-members.ts";
import {
	applyInviteAction,
	fetchSentInvitations,
	forceInviteDecision,
	insertInvitations,
	removeMemberRow,
} from "./live-invites.ts";
import { serverEnv } from "../../core/env.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { fetchChannelMessagePage } from "./live-messages.ts";
import { fetchSubmissionPage } from "./live-submissions.ts";
import {
	createStageRow,
	issueInvitation,
	type MintedStage,
	readIssuedInvitations,
	resolveInviteTarget,
	setMemberRoleRow,
} from "./live-membership.ts";
import { fetchProjectOverview } from "./live-overview.ts";
import {
	applyProjectUpdate,
	archiveProjectRow,
	commitTicketRow,
	fetchProjectSetup,
	insertProject,
	insertProjectMessage,
	insertSubmission,
	moveTicketRow,
	type WriteOutcome,
	type WriteRefusal,
} from "./live-writes.ts";
import { lockStateOf, onboardingLockRefusal, touchesLockableFields } from "./live-writes.ts";
import {
	applyOnboardingSim,
	effectiveOnboardingSim,
	findProjectSetup,
	type OnboardingSim,
} from "./setup-fixtures.ts";
import { findProjectOverview } from "./overview-fixtures.ts";
import {
	appendChannelMessage,
	appendHireInvites,
	appendSubmission,
	buildStubCard,
	buildStubMessage,
	buildStubSubmissionUnit,
	createdDetail,
	createdMemberRoster,
	createdSummary,
	findSentMessage,
	hireInviteCount,
	isStoredArchived,
	mergeSetupPatch,
	mintStageId,
	mintTicketId,
	movedStubCard,
	overlayBoardPage,
	overlayDetail,
	overlayFeed,
	overlayMemberRoster,
	overlayMessagePage,
	overlayOverview,
	overlaySetup,
	overlaySubmissionPage,
	overlaySummary,
	putTicketCard,
	recordApplicationSeat,
	recordCreatedProject,
	recordInviteAction,
	recordInviteDecision,
	recordMemberRemoval,
	recordProjectArchive,
	recordRoleChange,
	sentMessageCount,
	setupPatchFrom,
	storedCreatedProject,
	storedTicketCard,
	storedTicketProjectBySlug,
	stubSlugTaken,
	submissionCount,
	submitStoredSubmission,
	writeOwnerOf,
} from "./write-store.ts";
import {
	findProject,
	getFeed,
	getFeedFrom,
	groupFeed,
	incomingCount,
	incomingCountFrom,
	scopeOptions,
	scopeOptionsFrom,
	serviceOptions,
	withResolvableScope,
} from "./query.ts";
import { findProjectDetail } from "./detail-fixtures.ts";
import { findChannelMessage, findMessagePage } from "./messages-fixtures.ts";
import { replyFromMessage, replyRefusal } from "./message-replies.ts";
import { findFilePage } from "./files-fixtures.ts";
import { findSubmissionPage } from "./submissions-fixtures.ts";
import { BOARD_FIXTURE_NOW, findBoardPage, findTicketProjectSlug } from "./board-fixtures.ts";
import { findFixtureRequest, findMemberRoster } from "./members-fixtures.ts";
import { archiveDraft, getDraft, instantiateDraft, sweepStaleDrafts } from "./draft-store.ts";
import { composeLoadedViewPage } from "../explore/live-view.ts";
import { approveStageRow, exitStageRow, reviewSubmissionRow } from "./live-settlement.ts";
import { recordStubReview } from "./write-store.ts";
import type {
	ApproveStage,
	CancelStageFairExit,
	ReviewSubmission,
	StageApproved,
	StageExited,
	SubmissionReviewed,
} from "@projective/types/projects";
import {
	composeWorkspace,
	type ProjectWorkspace,
	type WorkspaceViewer,
} from "@projective/types/projects";

/**
 * The listing's composed page, from the catalogue snapshot `findItem` resolved it from a line
 * earlier — so the booking flow reads exactly the intake, session format and stage template the page
 * rendered. The throw is unreachable: `findItem` only returns an item when that snapshot exists.
 */
function buildViewPage(item: ExploreItem): EntityView {
	const view = composeLoadedViewPage(item);
	if (!view) throw new Error("explore catalogue snapshot vanished between two reads");
	return view;
}
import { findItem } from "../explore/query.ts";
import type {
	ArchiveDraftInput,
	InstantiateServiceInput,
	PipelineDraft,
} from "@projective/types/services";
import {
	activeInviteCooldown,
	blankStage,
	buildHireBrief,
	buildProjectTimeline,
	cooldownMessage,
	CREATED_PUBLISH_VISIBILITY,
	createFormatToColumns,
	DEFAULT_PROJECT_BUDGET,
	DEFAULT_PROJECT_RULES,
	HIRE_RATE_LIMIT,
	HIRE_RATE_LIMIT_MESSAGE,
	hireInvitationRefusal,
	inviteActionFor,
	invitesForScope,
	memberStagePicture,
	NO_REMOVAL_IMPACT,
	providerScopedPage,
	reconcileSetup,
	requestsForScope,
	resolveHireOffer,
	stageInviteAsHire,
	stageInviteRefusal,
} from "@projective/types/projects";
import { intakeRefusal, normaliseIntakeAnswers } from "@projective/types/services";
import { plainTextToHtml } from "@projective/types/richtext";
import { toMinorUnits } from "@projective/types/finance";
import type { EntityView, ExploreItem, ServiceItem } from "@projective/types/explore";
import { ProfileBackendService } from "../profile/ProfileBackendService.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";
import { dmConversationId } from "@projective/types/messaging";
import { maskPii } from "@projective/types/comms";
import {
	acceptApplicationLive,
	applyLive,
	rejectApplicationLive,
	respondLive,
} from "./live-applications.ts";
import {
	hasOpenStubApplication,
	recordRequestDecision,
	recordStubApplication,
	requestDecisionOf,
} from "./request-store.ts";
import type {
	AcceptApplication,
	ApplicationAccepted,
	ApplicationRejected,
	ApplyToProject,
	InvitationAnswered,
	MemberRequest,
	ProjectApplication,
	RejectApplication,
	RespondToInvitation,
} from "@projective/types/projects";
import type {
	ArchiveProject,
	AssignableMemberRole,
	BoardCard,
	BoardListParams,
	BoardPage,
	BoardStageRef,
	ChatMessage,
	CommitTicket,
	CreatedProject,
	CreatedStage,
	CreateProject,
	CreateStageInput,
	CreateSubmission,
	FileListPage,
	FileListParams,
	HireBrief,
	HireInvitation,
	HireOffer,
	InviteActionInput,
	InviteDecisionInput,
	InviteProjectMemberInput,
	InviteRefusal,
	InvitesSent,
	MemberInvite,
	MemberRoleChanged,
	MemberRosterPage,
	MemberRosterParams,
	MessagePage,
	MessagePageParams,
	MessageSender,
	MoveTicket,
	ProjectDetail,
	ProjectFeedParams,
	ProjectFeedPayload,
	ProjectMemberRow,
	ProjectOverview,
	ProjectSetup,
	ProjectSummary,
	RemoveMemberInput,
	RemoveMemberResult,
	SendProjectMessage,
	SentInvitesPage,
	StageInviteInput,
	SubmissionListPage,
	SubmissionListParams,
	SubmissionUnit,
	TimelineListParams,
	TimelinePage,
	UpdateProject,
} from "@projective/types/projects";

/**
 * ProjectBackendService — the FAT server-side service behind the `/projects` middle-nav feed.
 *
 * It owns the multi-tenant feed query: scope resolution, role/format/status/kind facet filtering,
 * the sticky quick-filters, the client-by-service filter, sorting, and context grouping — plus the
 * scope + service option matrices the filter panel renders. Thin routes under
 * `apps/web/routes/api/projects/*` do only HTTP parsing + Zod validation, then delegate here and map
 * the returned {@link ServiceResult} to a `Response`; the `/projects` route calls these directly for
 * SSR first paint. Islands never reach this — they `fetch` the routes via the thin
 * `ProjectSidebarService`.
 *
 * **Stub mode (default).** With `PROJECTS_BACKEND_LIVE` off (see {@link isProjectsBackendLive}) the
 * service answers from the in-memory fixtures — the running app is unchanged. The live path
 * (RLS-scoped `projects.*` + `org.*` membership reads, escrow-aware) slots in behind the same gate
 * when it lands, a fill-in rather than a re-architecture.
 */

/** Compose the feed payload from the pure selectors (the stub read path; also the live fallback). */
function buildFeed(params: ProjectFeedParams): ProjectFeedPayload {
	const items = getFeed(params);
	return {
		count: items.length,
		incomingCount: incomingCount(params),
		items,
		groups: groupFeed(items),
		scopes: scopeOptions(params.view),
		services: serviceOptions(),
	};
}

/**
 * Compose the feed payload from LIVE rows.
 *
 * The same selectors as {@link buildFeed}, applied to rows from Postgres instead of to the fixture
 * corpus — so the feed's meaning (what `priority` sorts by, what the involvement quick-filters
 * select, what a group is) is defined in exactly one place regardless of where the rows came from.
 *
 * `services` is empty rather than fixture-derived: the provider-service list comes from
 * `marketplace.service_blueprints`, a schema `supabase/config.toml` does NOT expose to PostgREST, so
 * there is no live source for it. An empty list renders as "no service filter available", which is
 * true; the fixture list would render as a filter that selects nothing.
 */
function buildLiveFeed(
	rows: readonly ProjectSummary[],
	params: ProjectFeedParams,
): ProjectFeedPayload {
	const items = getFeedFrom(rows, params);
	return {
		count: items.length,
		incomingCount: incomingCountFrom(rows, params),
		items,
		groups: groupFeed(items),
		scopes: scopeOptionsFrom(rows, scopesFromRows(rows), params.view),
		services: [],
	};
}

/**
 * Record that a live read failed and the fixtures answered instead.
 *
 * Warned rather than thrown or swallowed: thrown, a transient broker error takes down a surface the
 * fixtures could still render; swallowed, a permanently broken live path is indistinguishable from a
 * working one. Falling back cannot disclose anything — the fixture corpus belongs to nobody.
 */
/**
 * The outbound-invitation ceiling, per acting identity (`HIRE_RATE_LIMIT`: 10 sends per sliding 10
 * minutes). In-process — the same lifetime as the write-store the invitations land in — and reset
 * with it by tests.
 */
export const hireLimiter = new SlidingWindowLimiter(HIRE_RATE_LIMIT);

/** The feed query "every open engagement I own, across every workspace" — the Add-to-project rows. */
const OPEN_OWNED_FEED: ProjectFeedParams = {
	q: "",
	view: "projects",
	involvement: "owner",
	sort: "recent",
	scope: "global",
	scopeType: null,
	scopeId: "",
	workspaces: [],
	roles: [],
	formats: [],
	kinds: [],
	statuses: ["draft", "active", "on_hold"],
	quick: [],
	requests: [],
	serviceId: "",
};

function liveFailed(method: string, error: unknown): void {
	const reason = error instanceof Error ? error.message : String(error);
	console.warn(`[ProjectBackendService.${method}] live read failed, serving fixtures: ${reason}`);
}

/**
 * Narrow a roster's invitation and request queues to the routed stage — `invitesForScope` and
 * `requestsForScope`, applied ONCE here for both branches so the fixture roster, the live roster and
 * the stub overlay all answer a stage page with the same rule: in a stage channel only the records
 * addressed to THAT stage; in project scope every one; dismissed invitations nowhere.
 */
function scopeInvites(page: MemberRosterPage): MemberRosterPage {
	const invites = invitesForScope(page.invites, page.stageId);
	const requests = requestsForScope(page.requests, page.stageId);
	return invites.length === page.invites.length && requests.length === page.requests.length
		? page
		: { ...page, invites, requests };
}

/**
 * The roster row an accepted APPLICATION seats on the stub roster — the applicant as they applied,
 * holding the stage they applied to, with every count at zero. The id follows the fixture cast's
 * `{slug}-mem-{handle}` minting so a later read resolves the same row.
 */
function stubSeatFromRequest(
	projectId: string,
	request: MemberRequest,
	nowMs: number,
): ProjectMemberRow {
	const d = new Date(nowMs);
	const MONTHS = [
		"Jan",
		"Feb",
		"Mar",
		"Apr",
		"May",
		"Jun",
		"Jul",
		"Aug",
		"Sep",
		"Oct",
		"Nov",
		"Dec",
	];
	return {
		id: `${projectId}-mem-${request.applicant.handle ?? request.id}`,
		party: request.applicant,
		email: "",
		role: "freelancer",
		assignment: null,
		presence: "offline",
		assignedStages: request.stageName ? [request.stageName] : [],
		openTickets: 0,
		ticketsLabel: "—",
		joinedAt: d.toISOString(),
		joinedLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
		isViewer: false,
		impact: NO_REMOVAL_IMPACT,
	};
}

/**
 * The roster row a forced acceptance seats on the STUB roster.
 *
 * Built from the invitation alone — the person's handle (or the address they were invited at), the
 * role the invitation promised, the stage it named — with every count at zero: they have only just
 * joined, so there is nothing to attribute to them yet and nothing a removal would touch. The id is
 * minted the way `members-fixtures.ts` mints a cast member's (`{slug}-mem-{handle}`), so a fixture
 * accepted invitation that already names its member resolves to the same row rather than a twin.
 */
function stubJoinedMember(
	page: MemberRosterPage,
	invite: MemberInvite,
	nowMs: number,
): ProjectMemberRow {
	const bare = invite.handle?.replace(/^@+/, "") ?? null;
	const local = invite.email.includes("@") && !invite.email.startsWith("@")
		? invite.email.split("@")[0]
		: null;
	const seed = bare ?? local ?? invite.id;
	const name = bare
		? bare.split(/[-_.]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
		: local
		? local.split(/[-_.]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")
		: "New member";
	const joinedAt = new Date(nowMs).toISOString();
	const d = new Date(nowMs);
	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	return {
		id: `${page.projectId}-mem-${seed}`,
		party: { name, avatar: null, handle: bare },
		email: local ? invite.email : "",
		role: invite.role,
		assignment: null,
		presence: "offline",
		assignedStages: invite.stageName ? [invite.stageName] : [],
		openTickets: 0,
		ticketsLabel: "—",
		joinedAt,
		joinedLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
		isViewer: false,
		impact: NO_REMOVAL_IMPACT,
	};
}

/**
 * Run a cached live read, or return `undefined` to mean "the caller should use the fixtures".
 *
 * Six methods share this shape exactly, and writing it out six times is six chances for one of them
 * to forget the actor check, the cache key, or the try/catch. The `undefined` return is deliberately
 * distinct from the `null` a resolver returns for "no such row": `undefined` means the live path did
 * not run or could not answer, and the fixture branch takes over; `null` means the database was
 * asked and said no, which is a real 404 the caller must NOT paper over with a fabricated fixture.
 */
async function liveRead<T>(
	method: string,
	actor: ReadActor | undefined,
	namespace: string,
	key: unknown,
	run: (actor: ReadActor & { accessToken: string }) => Promise<T | null>,
): Promise<T | null | undefined> {
	if (!isProjectsBackendLive() || !actor || !canReadLive(actor)) return undefined;
	try {
		return await cachedRead(
			projectsReadCache,
			cacheKey(tenantOf(actor), namespace, key),
			() => run(actor),
		);
	} catch (error) {
		liveFailed(method, error);
		return undefined;
	}
}

// #region Write plumbing
/**
 * Evict this tenant's cached reads.
 *
 * Called after EVERY successful write, before the result is returned. Without it the GET that
 * follows a mutation is served the pre-mutation entry for the whole cache TTL, and the change looks
 * lost while the database is perfectly correct — a failure nothing in the write path can be blamed
 * for, because the statement committed, the service returned `ok`, and the row is right.
 *
 * The whole tenant prefix rather than the one namespace that changed: moving a ticket alters the
 * board, the detail projection's stage counts, the setup ladder's staffing step and the feed row's
 * progress meter, and a list of namespaces maintained by hand at each call site is a list one write
 * eventually forgets to extend.
 */
function invalidateProjects(actor: ReadActor): void {
	invalidatePrefix(projectsReadCache, tenantPrefix(tenantOf(actor)));
}

/**
 * The refusal a write returns when nobody is signed in.
 *
 * A write genuinely needs an identity, unlike the reads, which answer a guest from the fixture
 * corpus. This is the service's own guard and not an authorisation decision: RLS remains the real
 * gate (root CLAUDE.md §6), and no capability is checked here, because the Dev Context Switcher's
 * simulated persona never reaches the server and a capability bounce would fire on it
 * (Decision #53(b)).
 */
function requireIdentity<T>(actor: ReadActor, action: string): ServiceResult<T> | null {
	if (actor.userId.length > 0) return null;
	return fail<T>(401, { message: `Sign in to ${action}.` });
}

/** The uniform 404 for a slug or id that resolved to nothing the viewer can see. */
function noSuchProject<T>(id: string): ServiceResult<T> {
	return fail<T>(404, { message: `No project found for "${id}".` });
}

/**
 * The thing a write could not find, named for the reader.
 *
 * A write's `null` outcome means "the subject did not resolve", and the subject is not always a
 * project: sending a message resolves a CHANNEL, moving a ticket resolves a TICKET, filing a
 * submission resolves a STAGE. Reporting all four as "No project found for <a channel uuid>" is wrong
 * on both counts — the id is not a project's and the project is usually right there and readable.
 */
function notFound<T>(noun: string, id: string): ServiceResult<T> {
	return fail<T>(404, { message: `No ${noun} found for "${id}".` });
}

/** What a sent hire answers with. */
export interface HireSent {
	invites: MemberInvite[];
	total: number;
	placeholder: boolean;
	/** The DM the intro opened (or was posted into); null with no intro, or when it could not be posted. */
	conversationId: string | null;
}

function recordStubHireInvites(
	owner: string,
	brief: HireBrief,
	handle: string,
	offer: HireOffer,
): MemberInvite[] {
	const at = new Date().toISOString();
	const base = hireInviteCount(owner, brief.projectId);
	const stageOf = new Map(brief.stages.map((s) => [s.id, s]));
	const targets = brief.pricingModel === "task"
		? [{ stage: null as HireBrief["stages"][number] | null }]
		: offer.stages.map((line) => ({ stage: stageOf.get(line.stageId) ?? null }));
	const invites: MemberInvite[] = targets.map(({ stage }, i) => ({
		id: `${brief.projectId}-hire-${base + i + 1}`,
		email: `@${handle}`,
		handle: `@${handle}`,
		role: "freelancer",
		stageId: stage?.id ?? null,
		stageName: stage?.name ?? null,
		invitedBy: "You",
		invitedAt: at,
		invitedLabel: "Just now",
		status: "pending",
		// A staged assignment on an unpublished project: attached now, priced at publish.
		placeholder: offer.placeholder || undefined,
	}));
	appendHireInvites(owner, brief.projectId, invites);
	return invites;
}

// #region Membership-write helpers
/** The 429 the outbound-invitation ceiling answers with, carrying the instant it reopens. */
function rateLimitRefusal(retryAfterMs: number): WriteRefusal {
	return {
		status: 429,
		message: HIRE_RATE_LIMIT_MESSAGE,
		errors: { form: "rate_limited" },
		details: { retryAt: new Date(Date.now() + retryAfterMs).toISOString() },
	};
}

function rateLimited<T>(retryAfterMs: number): ServiceResult<T> {
	return refused<T>(rateLimitRefusal(retryAfterMs));
}

/** The machine code a refusal pins to its control — its first field error, or `refused`. */
function refusalCode(refusal: WriteRefusal): string {
	const first = refusal.errors ? Object.values(refusal.errors)[0] : undefined;
	return first ?? "refused";
}

/** "Invitation sent." · "3 invitations sent. 1 could not be sent." */
function invitesSentMessage(sent: InvitesSent): string {
	const n = sent.invites.length;
	const head = n === 1 ? "Invitation sent." : `${n} invitations sent.`;
	const r = sent.refused.length;
	return r === 0 ? head : `${head} ${r} could not be sent.`;
}

/**
 * A stage as the board projects it, for the one case the post-write re-read could not find it. The id
 * is echoed as the slug — NOT a `stg-…` shape — so `isSlug` refuses it and nothing links to an address
 * that has not been read back yet.
 */
function draftStageRef(id: string, input: CreateStageInput, order: number): BoardStageRef {
	return {
		id,
		slug: id,
		name: input.name,
		order,
		status: "draft",
		locked: false,
		description: input.description,
		unitPriceCents: null,
		categoryWeight: 1,
		members: [],
		ticketCount: 0,
		assignmentMode: "open_pull",
		maxConcurrentIntensity: null,
		startAt: null,
		endAt: null,
		dependsOnStageId: null,
	};
}

/**
 * Why the STUB path will not issue an invitation to `address`, or `null` — the rules the database
 * enforces on the live path (the ceiling, the 48-day decline cooldown, a duplicate open offer, a
 * person already on the project), stated in the same words so the two branches refuse identically.
 */
function stubInviteRefusal(
	page: MemberRosterPage,
	history: readonly MemberInvite[],
	address: string,
	stageId: string | null,
	nowMs: number,
	owner: string,
): { status: number; message: string; code: string } | null {
	if (!hireLimiter.peek(owner).allowed) {
		return { status: 429, message: HIRE_RATE_LIMIT_MESSAGE, code: "rate_limited" };
	}
	const bare = address.startsWith("@") ? address.slice(1) : null;
	if (bare) {
		const until = activeInviteCooldown(history, bare, nowMs);
		if (until) return { status: 422, message: cooldownMessage(until), code: "cooldown" };
		const onRoster = page.members.some((m) =>
			(m.party.handle ?? "").replace(/^@+/, "").toLowerCase() === bare
		);
		if (onRoster && stageId === null) {
			return { status: 409, message: "This person is already on the project.", code: "duplicate" };
		}
	}
	const open = page.invites.some((invite) =>
		invite.status === "pending" && (invite.stageId ?? null) === stageId &&
		(invite.email.toLowerCase() === address || (invite.handle ?? "").toLowerCase() === address)
	);
	if (open) {
		return {
			status: 409,
			message: "An invitation to this person for this stage is already pending.",
			code: "duplicate",
		};
	}
	return null;
}
// #endregion

/**
 * Post a request's opening message into the pair's DM (`MessagingBackendService.requestMessage`).
 * The request itself is already recorded and the other side already notified, so a failure here costs
 * only the DM: it is logged and answered `null`, never reported as a failed hire or application.
 */
async function postIntro(
	recipientUserId: string,
	body: string,
	projectId: string,
	actor: ReadActor,
): Promise<string | null> {
	try {
		const posted = await MessagingBackendService.requestMessage(
			recipientUserId,
			body,
			projectId,
			actor,
		);
		return posted?.threadId ?? null;
	} catch (error) {
		liveFailed("postIntro", error);
		return null;
	}
}

/** Map a {@link WriteRefusal} onto the service envelope, preserving the database's own wording. */
function refused<T>(refusal: WriteRefusal): ServiceResult<T> {
	return fail<T>(refusal.status, {
		message: refusal.message,
		errors: refusal.errors,
		details: refusal.details,
	});
}

/**
 * Run a live write, or return `undefined` to mean "the caller should use the stub store".
 *
 * The mirror of {@link liveRead} with one deliberate asymmetry: a live read that throws falls back
 * to the fixtures, and a live WRITE that throws must not. Falling back would run the stub, store the
 * change in memory and answer `ok` for a mutation Postgres never accepted — reporting a save that
 * did not happen, which is the one outcome worse than reporting a failure. So a thrown live write
 * surfaces as a `502` and the caller is told to try again.
 *
 * The same rule FAILS CLOSED on identity: with the live backend on, a caller who has a user id but no
 * access token (an expired or half-refreshed session) gets a `401`, never the stub store. Every write
 * already passed `requireIdentity`, so the only thing missing is the credential RLS needs — and
 * answering from memory would be the silent fallback this function exists to prevent.
 */
async function liveWrite<T>(
	method: string,
	actor: ReadActor,
	subject: string,
	message: string,
	run: (actor: ReadActor & { accessToken: string }) => Promise<WriteOutcome<T>>,
	/** What `subject` names — see {@link notFound}. Defaults to a project, which most writes resolve. */
	noun = "project",
): Promise<ServiceResult<T> | undefined> {
	if (!isProjectsBackendLive()) return undefined;
	if (!canReadLive(actor)) {
		return fail<T>(401, { message: "Your session has expired — sign in again to save this." });
	}
	try {
		const outcome = await run(actor);
		if (outcome === null) return notFound<T>(noun, subject);
		if ("refusal" in outcome) return refused<T>(outcome.refusal);
		invalidateProjects(actor);
		return ok(outcome.data, { message });
	} catch (error) {
		liveFailed(method, error);
		return fail<T>(502, { message: "That change could not be saved — please try again." });
	}
}

/**
 * The identity a stub-written row is authored by.
 *
 * Read out of the corpus rather than minted, by finding the viewer's own most recent message in the
 * channel. The fixture corpus already has a face and a name for the acting viewer, and a second
 * identity built here would put two different people's avatars on one person's messages inside a
 * single conversation.
 *
 * The fallback is deliberately plain. A message with an unnamed author is legible; one attributed to
 * a fabricated participant is a claim about who said it.
 */
// #region Create plumbing
/**
 * Mint an unused project slug for the STUB path.
 *
 * The title is not a parameter, and that is the change rather than an omission. This used to slugify
 * the title and append a random disambiguator, which had to solve three problems that only exist
 * because a title was involved at all — an empty result from a title of pure punctuation or a
 * non-Latin script, a near-certain collision between two people naming a project "Website refresh",
 * and a suffix that had to stay inside the shape CHECK. An opaque slug has none of them, and it fixes
 * the one the old shape could not: a title-derived address dies on the first rename.
 *
 * `taken` is the stub path's own uniqueness check, and it exists only here. On the live path
 * uniqueness belongs to the unique index, and `insertWithSlugRetry` re-mints against the write that
 * was actually refused — a pre-check there would be a round trip whose answer is stale before the
 * insert runs.
 *
 * A handful of attempts is generous for 50 bits against an in-memory store measured in dozens of
 * rows; if every one collides, something other than luck is wrong and the last candidate is returned
 * so the caller sees the real failure rather than an infinite loop.
 */
function mintProjectSlug(taken: (slug: string) => boolean): string {
	let candidate = mintSlug("project");
	for (let attempt = 1; attempt < SLUG_MAX_ATTEMPTS && taken(candidate); attempt++) {
		candidate = mintSlug("project");
	}
	return candidate;
}

/**
 * The projection a stub-created draft is stored and read back as.
 *
 * Built through `reconcileSetup`, so the ladder, the percentage and the Preview gate a freshly minted
 * project reports are computed by the SAME function that computes them for a fixture and for a live
 * row — a create that seeded its own completeness would be a second implementation of the one rule
 * this domain has been careful to keep single.
 *
 * The one root stage mirrors what {@link insertProject} provisions on the live path, so the two
 * branches do not disagree about what a new project contains. It is deliberately UNPRICED for a
 * pipeline — the baseline is a per-ticket rate, which the stage carries — and unpriced for a one-off,
 * whose figure is the PROJECT budget below it.
 */
function buildCreatedSetup(input: CreateProject, slug: string): ProjectSetup {
	const id = crypto.randomUUID();
	const stageName = input.format === "one_off" ? "Delivery" : "Stage 1";
	// The one mapping from the wizard's choice onto the stored pair — the same function the setup
	// form and the live insert use, so "Task" is minted as the structure they both read back.
	const columns = createFormatToColumns(input.format, input.hasStages);
	return reconcileSetup({
		id,
		slug,
		title: input.title.trim(),
		format: columns.format,
		structure: columns.structure,
		sessionKind: "none",
		status: "draft",
		archivedAt: null,
		// The wizard's one-line brief, as the escaped paragraph the rich-text column stores; empty
		// stays empty so an unwritten brief does not tick the description step off.
		description: plainTextToHtml(input.description),
		attachments: [],
		budget: {
			...DEFAULT_PROJECT_BUDGET,
			currency: input.currency,
			// Only a one-off's baseline is a project TOTAL. A pipeline's is a rate, and writing a rate
			// into the budget would tick the pricing ladder step off against a number that means
			// something else — the same distinction `insertProject` draws against the column.
			amountCents: input.format === "one_off" ? input.baselineAmountCents : null,
		},
		// `rules.visibility` is the publish INTENT, stored on its own column — a different fact from
		// `liveVisibility`, which `reconcileSetup` derives below and which stays `unlisted` for as long
		// as this is a draft. The two-column model is documented on `ProjectRulesSchema.visibility`; the
		// point here is only that stating `public` on a project one statement old publishes nothing.
		rules: { ...DEFAULT_PROJECT_RULES, visibility: CREATED_PUBLISH_VISIBILITY },
		stages: [{
			...blankStage(`${id}-stage-1`, stageName, 0),
			unitPriceCents: input.baselineAmountCents,
		}],
		roles: [],
		// The creator is the client. Nothing else could be true of a project one statement old.
		viewerIsClient: true,
	});
}

/**
 * The setup projection of a pipeline instantiated from a listing — what "Add to projects" mints.
 *
 * The draft store remembers the DRAFT (its slug, its source listing, whether it has been funded);
 * this is the same project as every other read sees it, so the feed lists it, the lane resolves it,
 * the setup page opens it and the profile's Add-to-project menu offers it — the reads a Quick-Init
 * draft already gets. Without it the board the buyer is sent to renders beside a lane reading
 * "Project not found", which is a project that exists for one read and not the next.
 *
 * Stages copy the blueprint's: name, brief, required skills, and the seat-pool ticket price in the
 * listing's own currency (a `TicketPrice` is MAJOR units, so it goes through the finance SSOT's
 * exponent-aware converter). A range prices at its floor — the figure the card and the lane print.
 */
function buildInstantiatedSetup(
	item: ServiceItem,
	view: EntityView,
	draft: { slug: string; title: string },
): ProjectSetup {
	const id = crypto.randomUUID();
	const currency = item.currency ?? "USD";
	const columns = createFormatToColumns("pipeline", true);
	const blueprint = view.service?.stages ?? [];
	const stages = blueprint.map((stage, index) => ({
		...blankStage(`${id}-stage-${index + 1}`, stage.name, index),
		description: plainTextToHtml(stage.description),
		unitPriceCents: toMinorUnits(stage.price.min, currency),
		skills: stage.skills.map((skill) => skill.label),
	}));
	return reconcileSetup({
		id,
		slug: draft.slug,
		title: draft.title,
		format: columns.format,
		structure: columns.structure,
		sessionKind: "none",
		status: "draft",
		archivedAt: null,
		description: plainTextToHtml(item.summary),
		attachments: [],
		budget: { ...DEFAULT_PROJECT_BUDGET, currency, amountCents: null },
		rules: { ...DEFAULT_PROJECT_RULES, visibility: CREATED_PUBLISH_VISIBILITY },
		stages: stages.length > 0 ? stages : [blankStage(`${id}-stage-1`, "Stage 1", 0)],
		roles: [],
		viewerIsClient: true,
	});
}

/** The write-store owner an instantiation belongs to — the draft store's own `(user, workspace)` scope. */
function draftWriteOwner(actor: { userId: string | null }, workspaceId: string | null): string {
	return writeOwnerOf({
		userId: actor.userId ?? "",
		contextId: workspaceId ?? actor.userId ?? "",
		contextType: workspaceId ? "team" : "personal",
	});
}
// #endregion

function viewerSenderFor(projectId: string, channelId: string | null): MessageSender {
	const channels = channelId
		? [channelId]
		: findProjectDetail(projectId)?.channels.general.map((channel) => channel.id) ?? [];
	for (const id of channels) {
		const page = findMessagePage({ projectId, channelId: id });
		const own = page?.messages.filter((message) => message.isOwn).at(-1);
		if (own?.sender) return own.sender;
	}
	return { id: "viewer", name: "You", avatar: null, handle: null };
}
// #endregion

// #region Settlement plumbing
/**
 * The refusal a settlement write returns before it runs, or `null` to proceed.
 *
 * Beyond {@link requireIdentity}, this closes the one path by which a money-moving write could reach
 * the stub with the live gate ON: a signed-in caller whose access token has lapsed fails
 * `canReadLive`, and `liveWrite` would answer `undefined` — "use the stub" — recording an approval
 * Postgres never saw. A 401 instead lets `apiFetch` refresh the session and retry the real write.
 */
function settlementDenied<T>(actor: ReadActor, action: string): ServiceResult<T> | null {
	const anonymous = requireIdentity<T>(actor, action);
	if (anonymous) return anonymous;
	if (isProjectsBackendLive() && !canReadLive(actor)) {
		return fail<T>(401, { message: "Your session expired. Sign in again to continue." });
	}
	return null;
}
// #endregion

export class ProjectBackendService {
	/**
	 * The context-scoped `/projects` feed: matched engagement rows, context groups, and the scope +
	 * service option matrices for the filter panel.
	 */
	static async list(
		params: ProjectFeedParams,
		actor: ReadActor,
	): Promise<ServiceResult<ProjectFeedPayload>> {
		if (!isProjectsBackendLive() || !canReadLive(actor)) {
			// Stub mode: drop a phantom scope pin (a real auth contextId matches no fixture workspace)
			// so the lane shows the acting account's feed instead of stranding empty. See
			// {@link withResolvableScope}. This covers BOTH the SSR first paint and the thin
			// `/api/projects/list` refetch (a stale cached scopeId), the single chokepoint they share.
			//
			// It runs on the guest path too: an unauthenticated caller cannot reach the live branch,
			// and `anon` holds no USAGE on the `projects` schema anyway, so the query would fail 42501
			// rather than return an empty feed.
			return ok(overlayFeed(buildFeed(withResolvableScope(params)), actor));
		}
		try {
			// The ROWS are cached, not the composed payload: the filter/sort facets change on every
			// keystroke of the lane's search, and caching per-facet-combination would miss constantly
			// while holding many near-identical copies of one tenant's projects.
			const key = cacheKey(tenantOf(actor), "projects.rows");
			const rows = await cachedRead(projectsReadCache, key, () => fetchProjectRows(actor));
			return ok(buildLiveFeed(rows, params));
		} catch (error) {
			liveFailed("list", error);
			return ok(overlayFeed(buildFeed(withResolvableScope(params)), actor));
		}
	}

	/** Look up a single engagement by slug — backs deep-link prefetch / row focus. */
	static async item(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ item: ProjectSummary }>> {
		if (isProjectsBackendLive() && canReadLive(actor)) {
			try {
				const key = cacheKey(tenantOf(actor), "projects.item", { slug });
				const item = await cachedRead(
					projectsReadCache,
					key,
					() => fetchProjectBySlug(actor, slug),
				);
				// A live miss is a real 404 — the slug does not exist, or RLS withholds it. Falling
				// through to the fixtures would answer a genuine "no" with a fabricated "yes".
				if (item) return ok({ item });
				return fail(404, { message: `No project found for slug "${slug}".` });
			} catch (error) {
				liveFailed("item", error);
			}
		}
		const drafted = createdSummary(slug, actor);
		if (drafted) return ok({ item: drafted });

		const found = findProject(slug);
		if (!found) return fail(404, { message: `No project found for slug "${slug}".` });
		// The same overlay the feed takes. Without it a rename made on the setup surface was visible
		// there and stale on the card beside it, and an archived project answered as though it were
		// live — `overlaySummary` returns null for one, which is a 404 here.
		const item = overlaySummary(found, actor);
		if (!item) return fail(404, { message: `No project found for slug "${slug}".` });
		return ok({ item });
	}

	/**
	 * The deep single-engagement projection behind the Project Details sidebar
	 * (`/projects/[projectId]`): the contextual header, core view links data, member roster, and the
	 * four-group communication channel tree. SSR calls this directly for first paint; the sidebar
	 * island refines via the thin route.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `projects.project_stages.status` is the 8-member `stage_status` enum (open/assigned/in_progress/
	 * submitted/approved/revisions/paid/cancelled) while `StageChannel.status` reuses the 5-member
	 * `ProjectStatus` (draft/active/on_hold/completed/cancelled). The ONLY member they share is
	 * `cancelled`, so every live stage would land on a value the projection cannot express, and
	 * `stageLocked(stage) = stage.status !== "draft"` is written against a value the database can
	 * never produce. A mapping table is a decision about what a stage MEANS, not a cast.
	 */
	static async detail(
		slug: string,
		actor?: ReadActor,
	): Promise<ServiceResult<{ detail: ProjectDetail }>> {
		const live = await liveRead(
			"detail",
			actor,
			"projects.detail",
			{ slug },
			(a) => fetchProjectDetail(a, slug),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: `No project found for slug "${slug}".` });
			return ok({ detail: live });
		}
		// A project this viewer DRAFTED has no fixture underneath it. Asked first, because this is the
		// read the `/projects/[projectId]` role dispatcher branches on: a null detail defaults
		// `viewerIsClient` to false and sends the creator to the member dashboard, which then renders
		// "Project not found" over a project that was created perfectly well.
		const created = createdDetail(slug, actor);
		if (created) return ok({ detail: created });

		const detail = findProjectDetail(slug);
		if (!detail) {
			return fail(404, { message: `No project found for slug "${slug}".` });
		}
		return ok({ detail: overlayDetail(detail, actor) });
	}

	/**
	 * A page of a channel's conversation (`/projects/[projectId]/[channelId]/chat`): the message feed
	 * behind the bottom-anchored, virtualized chat view. Bottom-anchored history — `before` unset yields
	 * the latest page, a `before` cursor yields the strictly-older page (the scroll-up load). Also carries
	 * the sticky pinned set + the viewer's pin capability. SSR calls this directly for first paint; the
	 * feed island refines / paginates via the thin `MessagesService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `comms.project_messages` IS readable (it has a real SELECT policy), but the projection is not
	 * reachable: `comms.message_attachments` is polymorphic with NO foreign key on `message_id`, so
	 * PostgREST cannot embed it (it needs its own keyed query); and a project channel has NO
	 * per-viewer read watermark anywhere, so `unread` has no backing. The pins/reactions/favourites
	 * tables are no longer a blocker — they had RLS switched off entirely and now carry policies.
	 * Separately, `trg_mask_message_pii` may have rewritten the body in place with no field on
	 * `ChatMessage` to disclose that it did.
	 */
	static async messages(
		params: MessagePageParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: MessagePage }>> {
		const live = await liveRead(
			"messages",
			actor,
			"projects.messages",
			params,
			(a) => fetchChannelMessagePage(a, params),
		);
		if (live !== undefined) {
			if (!live) return fail(404, { message: "No such project channel." });
			return ok({ page: live });
		}
		const page = findMessagePage(params);
		if (!page) return fail(404, { message: "No such project channel." });
		// Only the LATEST page takes the fold. A sent message postdates the whole channel, so folding
		// it into an older page fetched by the scroll-up cursor would insert it into history it comes
		// after — and the feed would then render the same message twice on the way back down.
		return ok({ page: overlayMessagePage(page, params.projectId, !params.before, actor) });
	}

	/**
	 * A page of files for the File Explorer — the attachments shared across a project's channels
	 * (`/projects/[projectId]/files`) or one channel (`/projects/[projectId]/[channelId]/files`).
	 * `channelId` unset/null selects the whole project (all channels, plus the channel index the tree
	 * navigator renders); set narrows to that channel. The page is already sorted + filtered + cursor-
	 * paged for the virtualized grid/list. SSR calls this directly for first paint; the explorer island
	 * refines (sort/filter/scroll-load) via the thin `FilesService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `FileItem` is a NARROWING of `AssetItemSchema` that re-mandates `channelId`/`channelName`/
	 * `channelKind`/`messageId`/`messageText`/`sender` as non-null `min(1)`, and `comms.channel_files`
	 * has no `message_id` column at all — so a channel-level file can satisfy the broader `AssetItem`
	 * and can NEVER satisfy `FileItem`. Constructing one also needs the required 28-member
	 * `FileCategory` and fifteen hub facets that no column supplies.
	 */
	static async files(
		params: FileListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: FileListPage }>> {
		const live = await liveRead(
			"files",
			actor,
			"projects.files",
			params,
			(a) => fetchFilePage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findFilePage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page });
	}

	/**
	 * A page of the Submissions explorer — the deliverable hierarchy a client reviews, scoped to one
	 * channel (`/projects/[projectId]/[channelId]/submissions/…`) or the whole project (Stages as tree
	 * roots, `/projects/[projectId]/submissions/…`). Returns the navigation tree, the files under the
	 * requested `path` (already sorted + filtered + cursor-paged), the breadcrumb trail, and — when the
	 * path resolves to a submission unit — the review projection the review workspace modal renders. SSR
	 * calls this directly for first paint; the explorer island refines / navigates via the thin
	 * `SubmissionsService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * A hard spelling mismatch: Zod `SubmissionStatus` has `revision_requested` (singular) while the
	 * CHECK on `projects.stage_submissions.status` writes `revisions_requested` (plural). Every
	 * revision row would fail Zod parse. Compounding it, the column is NULLABLE and a SQL CHECK is
	 * NULL-tolerant, so an explicit NULL is storable, passes the constraint, and fails the required
	 * Zod field. Reconciling the two spellings is a data decision.
	 */
	static async submissions(
		params: SubmissionListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: SubmissionListPage }>> {
		const live = await liveRead(
			"submissions",
			actor,
			"projects.submissions",
			params,
			(a) => fetchSubmissionPage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findSubmissionPage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		return ok({ page: overlaySubmissionPage(page, actor) });
	}

	/**
	 * The Kanban board — the project-level pipeline (`/projects/[projectId]/board`, columns = New + the
	 * Stages + Completed) or a stage-level Tasks board (`/projects/[projectId]/[channelId]/tasks`, columns
	 * = the ticket-status lanes). Returns the columns, the ticket cards (already filtered), the stage list
	 * (for the ticket modal + Stages/Status toggle), and the viewer capability flags that gate client-only
	 * moves + creation. SSR calls this directly for first paint; the board island refines (search/filter/
	 * view) via the thin `BoardService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * `BoardStageRef.categoryWeight` is bounded 0..10 and has NO column anywhere — it drives the
	 * workload figure `W_i`, so inventing it makes the number plausible and wrong (already flagged by
	 * Decision #64(b)). `TicketPaymentEntry` needs the `finance` schema, on which `authenticated`
	 * holds no USAGE. And `BoardListParams` has no cursor at all, so a live board would serialise
	 * every ticket's full attachment/history/submission/payment graph in one unpaged response.
	 */
	static async board(
		params: BoardListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: BoardPage }>> {
		const live = await liveRead(
			"board",
			actor,
			"projects.board",
			params,
			(a) => fetchBoardPage(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: live });
		}
		const page = findBoardPage(params);
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		// Scoped AFTER the overlay: the fixture read already withheld what a provider may not see, but
		// the overlay can add stub-written cards, and those go through the same rule. Idempotent, so a
		// second pass over an already-filtered page costs nothing and hides nothing extra.
		return ok({ page: providerScopedPage(overlayBoardPage(page, actor)) });
	}

	/**
	 * One ticket by its `tkt-…` slug — the `?tkv=` deep link's read — with the board it belongs to.
	 *
	 * A LOCATION lookup followed by the ordinary {@link board} read, and deliberately not a second
	 * card assembler: the modal needs the engagement's stages, roster, workspace and every sibling
	 * card beside the ticket itself, and a card composed on its own here would be a second answer to
	 * what a ticket costs (the Decision #66 rule, one arithmetic path). Routing through `board` also
	 * means the deep link inherits the board's cache entry, its stub overlay and — the part that
	 * matters — its provider scoping, so the access decision is made ONCE, by the read every other
	 * ticket surface already trusts.
	 *
	 * The access decision itself: on the live path RLS on `projects.tickets` answers the location
	 * lookup, and `fetchBoardPage` re-applies the participant filter; on the stub path
	 * {@link providerScopedPage} withholds what a provider may not see. In both, a ticket the viewer
	 * may not open is simply ABSENT from the page — and absent is reported with the same words as
	 * non-existent, because a deep link is pasted from anywhere and the difference would let anyone
	 * probe which addresses are real.
	 *
	 * A malformed slug is refused before any read: the shape says it cannot address a ticket, and a
	 * query for it would be a query matching nothing forever (the Decision #85 trap).
	 */
	static async ticket(
		slug: string,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: BoardPage; card: BoardCard }>> {
		const notFound = () =>
			fail<{ page: BoardPage; card: BoardCard }>(404, {
				message: "That ticket could not be found, or you do not have access to it.",
			});
		if (!isSlug(slug, "ticket")) return notFound();

		let projectSlug: string | null;
		const live = await liveRead(
			"ticket",
			actor,
			"projects.ticket",
			{ slug },
			(a) => fetchTicketLocation(a, slug),
		);
		if (live !== undefined) {
			if (!live) return notFound();
			projectSlug = live.projectSlug;
		} else {
			// The stub store first: a ticket created through the stub path exists nowhere in the fixture
			// corpus, and a corpus walk that ran first would spend its whole cost to say "not here".
			projectSlug = storedTicketProjectBySlug(writeOwnerOf(actor), slug) ??
				findTicketProjectSlug(slug);
		}
		if (!projectSlug) return notFound();

		const board = await ProjectBackendService.board(
			{ projectId: projectSlug, view: "stages" },
			actor,
		);
		if (!board.ok || !board.data) return notFound();
		const card = board.data.page.cards.find((c) => c.slug === slug);
		if (!card) return notFound();
		return ok({ page: board.data.page, card });
	}

	/**
	 * The Timeline / Gantt read — `/projects/[projectId]/timeline` for the whole engagement, or one
	 * stage's schedule when `channelId` is set.
	 *
	 * A PROJECTION over {@link board}, not a second read: the same live query (and the same cache
	 * entry) or the same fixture page, laid onto a time axis by the SSOT's `buildProjectTimeline`.
	 * The instant it is built at is the server's clock on the live path and the fixture corpus's
	 * pinned clock on the stub path, because the fixtures' due dates were placed relative to THAT
	 * instant and a "today" rule drawn from the real clock would put every one of them years in the
	 * past. The display timezone is left `null` for the viewer's own zone to govern — the server has
	 * no better answer than the browser does.
	 */
	static async timeline(
		params: TimelineListParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: TimelinePage }>> {
		const boardParams: BoardListParams = {
			projectId: params.projectId,
			channelId: params.channelId ?? null,
			view: "stages",
		};
		const live = await liveRead(
			"timeline",
			actor,
			"projects.board",
			boardParams,
			(a) => fetchBoardPage(a, boardParams),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: buildProjectTimeline(live, { nowMs: Date.now(), timezone: null }) });
		}
		const board = findBoardPage(boardParams);
		if (!board) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		const page = buildProjectTimeline(providerScopedPage(overlayBoardPage(board, actor)), {
			nowMs: BOARD_FIXTURE_NOW,
			timezone: null,
		});
		return ok({ page });
	}

	/**
	 * The Members roster — the participants with access to the whole project
	 * (`/projects/[projectId]/members`) or one channel/stage (`/projects/[projectId]/[channelId]/members`),
	 * with their role, stage assignment (contributor/observer), presence, workload, contact + join date,
	 * the pending-invitation queue, and the viewer capability flags that gate the client/admin/manager
	 * management actions. Also honours the DEV-ONLY simulation hints (`simViewer`/`simProjectType`/
	 * `simPendingInvites`) so the surface can be exercised across every role/type/invite state. SSR calls
	 * this directly for first paint; the roster island refines / re-simulates via the thin `MembersService`.
	 *
	 * **Live behind `PROJECTS_BACKEND_LIVE`.** The contradiction below is now RESOLVED in the
	 * mapping layer rather than blocking the read; it is kept because it is why certain fields are
	 * neutral rather than absent:
	 * There is no presence column in either schema, so `MemberPresence` — which is required, not
	 * nullable — has no source. `InviteStatus` is `(pending, expired)` while the DB CHECK on
	 * `projects.project_invitations.role` allows `('pending','accepted','expired','revoked')`, so two
	 * storable values fail parse. `projects.project_participants.role` is unconstrained free text
	 * whose only written value is `'assignee'` — not a member of `ProjectViewerRole` at all. And
	 * `ProjectMemberRow.email` has no column on `org.users_public`.
	 */
	static async members(
		params: MemberRosterParams,
		actor?: ReadActor,
	): Promise<ServiceResult<{ page: MemberRosterPage }>> {
		const live = await liveRead(
			"members",
			actor,
			"projects.members",
			params,
			(a) => fetchLiveMemberRoster(a, params),
		);
		if (live !== undefined) {
			if (!live) {
				return fail(404, { message: `No project found for id "${params.projectId}".` });
			}
			return ok({ page: scopeInvites(live) });
		}
		// A project this viewer drafted in the stub store has no fixture roster; it answers with its
		// creator as the sole member, so the profile's assignment modal can open on it.
		const page = findMemberRoster(params) ??
			(params.channelId ? null : createdMemberRoster(params.projectId, actor));
		if (!page) {
			return fail(404, { message: `No project found for id "${params.projectId}".` });
		}
		// Invitations sent from a seller's profile, and every stub-path transition on them, fold onto
		// the list (fixture branch only) BEFORE the stage scoping — a hire may address another stage. A
		// request the stub has already answered is history, not a queue entry.
		const overlaid = overlayMemberRoster(page, actor);
		const open = overlaid.requests.filter((request) => requestDecisionOf(request.id) === null);
		return ok({ page: scopeInvites({ ...overlaid, requests: open }) });
	}

	/**
	 * The client's act on one invitation they sent: `cancel` an open offer, or `dismiss` an answered
	 * or lapsed record. Which act a row admits is `inviteActionFor`'s decision, re-checked here so the
	 * list and the write cannot disagree — a stale client that rendered Dismiss on a row the invitee
	 * has since accepted is refused, not obeyed.
	 *
	 * Live: an UPDATE under the owner's own RLS (`live-invites.ts`). Stub: an overlay in the write
	 * store, so the change survives a reload exactly as a live one would.
	 */
	static async inviteAction(
		input: InviteActionInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ inviteId: string; action: InviteActionInput["action"] }>> {
		const denied = requireIdentity<{ inviteId: string; action: InviteActionInput["action"] }>(
			actor,
			"manage invitations",
		);
		if (denied) return denied;
		const done = { inviteId: input.inviteId, action: input.action };
		const message = input.action === "cancel" ? "Invitation cancelled." : "Invitation dismissed.";

		const live = await liveWrite(
			"inviteAction",
			actor,
			input.inviteId,
			message,
			async (a) => {
				const outcome = await applyInviteAction(a, input);
				if (outcome === null) return null;
				if ("refusal" in outcome) return outcome;
				return { data: done };
			},
			"invitation",
		);
		if (live !== undefined) return live;

		const located = this.stubInvite(input.projectId, input.inviteId, actor);
		if (!located) return notFound("invitation", input.inviteId);
		const admitted = inviteActionFor(located.invite.status);
		if (admitted !== input.action) {
			return fail(409, {
				message: input.action === "cancel"
					? `This invitation has already been ${located.invite.status}; it can no longer be cancelled.`
					: "An open invitation is cancelled, not dismissed.",
				errors: { inviteId: input.action === "cancel" ? "not_pending" : "still_pending" },
			});
		}
		recordInviteAction(writeOwnerOf(actor), located.page.projectId, input.inviteId, input.action);
		invalidateProjects(actor);
		return ok(done, { message });
	}

	/**
	 * FORCE an invitee's answer — the Dev Tools Invites window's Accept / Reject, so an invite flow can
	 * be walked through every state without a second account.
	 *
	 * Gated twice, on the SERVER's word: `DENO_ENV` must say development (a request cannot assert its
	 * way past this — a forced acceptance that shipped to production would be a client granting itself
	 * a seat on a stranger's project), and the caller must OWN the invitation. The live path then runs
	 * `projects.fn_apply_invitation_decision` through the service role — the ONE implementation of an
	 * acceptance, the body the invitee's own RPC runs — so the rows written are the rows a real answer
	 * writes. The stub path records the same transition in the write store and, on an acceptance, seats
	 * the invitee on the roster.
	 */
	static async decideInvite(
		input: InviteDecisionInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ invite: MemberInvite | null }>> {
		if (serverEnv().appEnv !== "development") {
			return fail(404, { message: "Not found." });
		}
		const denied = requireIdentity<{ invite: MemberInvite | null }>(actor, "manage invitations");
		if (denied) return denied;
		const message = input.decision === "accept"
			? "Invitation accepted on the invitee's behalf."
			: "Invitation declined on the invitee's behalf.";

		const live = await liveWrite(
			"decideInvite",
			actor,
			input.inviteId,
			message,
			async (a) => {
				const outcome = await forceInviteDecision(a, input);
				if (outcome === null) return null;
				if ("refusal" in outcome) return outcome;
				return { data: { invite: outcome.data } };
			},
			"invitation",
		);
		if (live !== undefined) return live;

		const located = this.stubInvite(input.projectId, input.inviteId, actor);
		if (!located) return notFound("invitation", input.inviteId);
		if (located.invite.status !== "pending") {
			return fail(409, {
				message: `This invitation has already been ${located.invite.status}.`,
				errors: { inviteId: "not_pending" },
			});
		}
		const owner = writeOwnerOf(actor);
		const now = Date.now();
		const joined = input.decision === "accept"
			? stubJoinedMember(located.page, located.invite, now)
			: null;
		recordInviteDecision(owner, located.page.projectId, input.inviteId, input.decision, joined, now);
		invalidateProjects(actor);
		const after = this.stubInvite(input.projectId, input.inviteId, actor);
		return ok({ invite: after?.invite ?? null }, { message });
	}

	/**
	 * Remove an active participant from the engagement, or unassign them from one stage — the action
	 * an ACCEPTED invitation's row and a member's own kebab both offer.
	 *
	 * The consequences are `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket, APPLIED on the live path by
	 * `projects.remove_project_member` (escrow to the freelancer, tickets back to New, assignments
	 * released, the participant row gone on a whole-project removal) and reported back as the counts
	 * it touched. The stub path records the removal in the write store and reports the counts the
	 * roster row already carried, since it has no tickets to move.
	 */
	static async removeMember(
		input: RemoveMemberInput,
		actor: ReadActor,
	): Promise<ServiceResult<RemoveMemberResult>> {
		const denied = requireIdentity<RemoveMemberResult>(actor, "manage members");
		if (denied) return denied;
		const message = input.stageId ? "Unassigned from the stage." : "Removed from the project.";

		const live = await liveWrite(
			"removeMember",
			actor,
			input.memberId,
			message,
			(a) => removeMemberRow(a, input),
			"member",
		);
		if (live !== undefined) return live;

		const page = this.stubRoster(input.projectId, actor);
		if (!page) return noSuchProject(input.projectId);
		const row = page.members.find((m) => m.id === input.memberId);
		if (!row) return notFound("member", input.memberId);
		if (row.isViewer) {
			return fail(409, { message: "You cannot remove yourself.", errors: { memberId: "self" } });
		}
		if (row.role === "owner" || row.role === "client") {
			return fail(409, {
				message: "The client side of the engagement cannot be removed here.",
				errors: { memberId: "client_side" },
			});
		}
		if (input.stageId && !page.stages.some((stage) => stage.id === input.stageId)) {
			return fail(422, {
				message: "That stage is not part of this project.",
				errors: { stageId: "unknown_stage" },
			});
		}
		recordMemberRemoval(writeOwnerOf(actor), page.projectId, row.id, input.stageId);
		invalidateProjects(actor);
		return ok(
			{
				memberId: row.id,
				removedFrom: input.stageId ? "stage" : "project",
				impact: row.impact ?? NO_REMOVAL_IMPACT,
			},
			{ message },
		);
	}

	/**
	 * Every invitation the caller has sent, grouped by project — the Dev Tools Invites window's read.
	 * Development-only on the server, like `decideInvite`, because it exists to feed a forcing control
	 * that must not exist anywhere else.
	 */
	static async sentInvites(actor: ReadActor): Promise<ServiceResult<{ page: SentInvitesPage }>> {
		if (serverEnv().appEnv !== "development") {
			return fail(404, { message: "Not found." });
		}
		const denied = requireIdentity<{ page: SentInvitesPage }>(actor, "see your invitations");
		if (denied) return denied;

		if (isProjectsBackendLive() && canReadLive(actor)) {
			try {
				return ok({ page: await fetchSentInvitations(actor) });
			} catch (error) {
				liveFailed("sentInvites", error);
				return fail(502, { message: "Your invitations could not be read — please try again." });
			}
		}

		const feed = await this.list(OPEN_OWNED_FEED, actor);
		if (!feed.ok || !feed.data) return fail(feed.status, { message: feed.message });
		const projects: SentInvitesPage["projects"] = [];
		let total = 0;
		for (const row of feed.data.items) {
			const page = this.stubRoster(row.slug, actor);
			if (!page) continue;
			const invites = invitesForScope(page.invites, null);
			total += invites.length;
			projects.push({ id: row.slug, title: row.title, status: row.status, invites });
		}
		return ok({ page: { projects, total } });
	}

	/** The stub roster for a project slug, with every write-store overlay applied, or `null`. */
	private static stubRoster(projectId: string, actor: ReadActor): MemberRosterPage | null {
		const page = findMemberRoster({ projectId }) ?? createdMemberRoster(projectId, actor);
		return page ? overlayMemberRoster(page, actor) : null;
	}

	/** One invitation on the stub roster, located by id, or `null` when the project or row is not there. */
	private static stubInvite(
		projectId: string,
		inviteId: string,
		actor: ReadActor,
	): { page: MemberRosterPage; invite: MemberInvite } | null {
		const page = this.stubRoster(projectId, actor);
		if (!page) return null;
		const invite = page.invites.find((row) => row.id === inviteId);
		return invite ? { page, invite } : null;
	}

	/**
	 * The brief a client's profile-side "Hire" invitation modal opens on — a COMPOSITION of the two
	 * reads the owner already has ({@link setup} for the stages and their prices, {@link members} for
	 * the roster), assembled by the SSOT's `buildHireBrief` so the modal cannot disagree with either
	 * surface about what a stage costs or who is on it. No fourth read of the project exists for it.
	 *
	 * A viewer who is not the client of the engagement gets a 404 from the setup read (it is the
	 * owner's projection), which is the right answer: there is nothing here for them to hire into.
	 *
	 * `handle` names the seller the brief is FOR, so it carries their re-invitation cooldown
	 * (`cooldownUntil`) — from the roster's declined invitations on the stub branch, from ONE
	 * `project_invitations` read on the live one. Absent, the brief carries none.
	 */
	static async hireBrief(
		slug: string,
		actor: ReadActor,
		handle?: string,
	): Promise<ServiceResult<{ brief: HireBrief }>> {
		const denied = requireIdentity<{ brief: HireBrief }>(actor, "invite someone to a project");
		if (denied) return denied;
		const [setupRead, rosterRead] = await Promise.all([
			this.setup(slug, actor),
			this.members({ projectId: slug }, actor),
		]);
		if (!setupRead.ok || !setupRead.data) {
			return fail(setupRead.status, { message: setupRead.message });
		}
		if (!rosterRead.ok || !rosterRead.data) {
			return fail(rosterRead.status, { message: rosterRead.message });
		}
		const setup = setupRead.data.setup;
		if (setup.archivedAt) {
			return fail(409, { message: "This project is archived — nobody can be invited to it." });
		}
		const bare = handle?.replace(/^@+/, "") ?? "";
		const brief = buildHireBrief(
			setup,
			rosterRead.data.page,
			bare ? { handle: bare } : undefined,
		);
		if (bare && brief.cooldownUntil === null) {
			// The live queue is the same rows, but the roster read may have withheld the queue from a
			// non-managing viewer; the dedicated read answers for the inviter regardless.
			const cooldowns = await this.hireCooldowns(bare, actor);
			brief.cooldownUntil = cooldowns[brief.projectId] ?? null;
		}
		return ok({ brief });
	}

	/**
	 * Every ACTIVE re-invitation cooldown this viewer is under for one seller, keyed by project slug —
	 * the read behind the profile's Add-to-project rows, which disable a locked project and print the
	 * date it reopens. One query on the live branch ({@link fetchDeclinedInvitations}); on the stub
	 * branch the declined invitations in each open project's roster, through the SAME
	 * `activeInviteCooldown` the brief and the write use. A guest has sent nothing and gets `{}`.
	 */
	static async hireCooldowns(
		handle: string,
		actor: ReadActor,
	): Promise<Record<string, string>> {
		if (!actor.userId) return {};
		const bare = handle.replace(/^@+/, "");
		if (!bare) return {};
		const nowMs = Date.now();

		const live = await liveRead(
			"hireCooldowns",
			actor,
			"projects.hireCooldowns",
			{ handle: bare },
			(a) => fetchDeclinedInvitations(a, bare),
		);
		if (live !== undefined && live !== null) {
			const out: Record<string, string> = {};
			for (const [slug, declines] of Object.entries(live)) {
				const until = activeInviteCooldown(
					declines.map((d) => ({
						status: "declined" as const,
						declinedAt: d.declinedAt,
						handle: bare,
					})),
					bare,
					nowMs,
				);
				if (until) out[slug] = until;
			}
			return out;
		}

		const feed = await this.list(OPEN_OWNED_FEED, actor);
		if (!feed.ok || !feed.data) return {};
		const out: Record<string, string> = {};
		for (const row of feed.data.items) {
			const page = findMemberRoster({ projectId: row.slug }) ??
				createdMemberRoster(row.slug, actor);
			if (!page) continue;
			// DISMISSED declines included: a client who acknowledged a refusal still waits out its
			// cooldown, exactly as the live read — which queries the table, not the list — makes them.
			const until = activeInviteCooldown(
				overlayMemberRoster(page, actor, { keepDismissed: true }).invites,
				bare,
				nowMs,
			);
			if (until) out[row.slug] = until;
		}
		return out;
	}

	/**
	 * Invite a seller into a project from their profile — the Hire flow's WRITE.
	 *
	 * Validated against the brief the modal rendered from, through the SAME `hireInvitationRefusal`
	 * the modal used to gate its Send control, so nothing the form let through is refused for a rule
	 * it did not know. One pending invitation is recorded PER SELECTED STAGE (or one whole-project
	 * invitation for a task-priced engagement), because that is the grain `projects.project_invitations`
	 * stores — one row, one stage.
	 *
	 * **Persistence is the per-process store on BOTH sides of the gate, deliberately.** The live table
	 * addresses an invitee by `target_email`, which the inviter cannot resolve for another user under
	 * RLS (`org.user_emails` is own-rows-only), and it carries neither the offered compensation nor the
	 * intro message. Inserting a row that drops two of the three things the client just typed would be
	 * reporting a success the database did not record; the honest path is to keep the whole offer here
	 * until the table can hold it. The invitation still reaches the seller as a message: the intro text
	 * and the offer are what the conversation the two already share is for, and the modal opens it.
	 */
	static async hire(
		input: HireInvitation,
		actor: ReadActor,
	): Promise<ServiceResult<HireSent>> {
		const denied = requireIdentity<HireSent>(actor, "invite someone to a project");
		if (denied) return denied;
		const handle = input.handle.replace(/^@/, "");

		/*
		 * The anti-spam ceiling, checked BEFORE the brief is read: a caller at the limit must not be able
		 * to spend the server's reads finding that out, and PEEKED rather than taken — the send counts
		 * only once it has actually been accepted below, so a refused offer (a wrong stage, a cooldown)
		 * does not eat into the allowance of the corrected one.
		 */
		const owner = writeOwnerOf(actor);
		const ceiling = hireLimiter.peek(owner);
		if (!ceiling.allowed) {
			return fail(429, {
				message: HIRE_RATE_LIMIT_MESSAGE,
				errors: { form: "rate_limited" },
				details: { retryAt: new Date(Date.now() + ceiling.retryAfterMs).toISOString() },
			});
		}

		const briefRead = await this.hireBrief(input.projectId, actor, handle);
		if (!briefRead.ok || !briefRead.data) {
			return fail(briefRead.status, { message: briefRead.message });
		}
		const brief = briefRead.data.brief;
		// The cooldown rides the brief (`cooldownUntil`), so the refusal below names the date it lifts —
		// and carries the exact instant, so a client can show it in the reader's own zone.
		const refusal = hireInvitationRefusal(brief, input);
		if (refusal) {
			return fail(422, {
				message: refusal.message,
				errors: refusal.errors,
				details: refusal.errors.projectId === "cooldown"
					? { reopensAt: brief.cooldownUntil ?? null }
					: undefined,
			});
		}

		/*
		 * The SELLER's own intake, held by the same rule the modal ran.
		 *
		 * A seller who asks three questions before joining a project is owed three answers whether or
		 * not the client's page honoured the marks; the profile read is what the modal rendered from, so
		 * the list checked here is the list the client saw. An unresolvable seller is a 404 rather than
		 * an unchecked invitation — there is nobody to invite.
		 */
		const sellerRead = await ProfileBackendService.overview(`@${handle}`, actor);
		if (!sellerRead.ok || !sellerRead.data) {
			return fail(404, { message: `No profile found for "@${handle}".` });
		}
		const intake = sellerRead.data.profile.hireIntake ?? [];
		const answers = normaliseIntakeAnswers(intake, input.answers);
		const intakeBlock = intakeRefusal(intake, answers);
		if (intakeBlock) {
			return fail(422, {
				message: intakeBlock.message,
				errors: { [`answers.${intakeBlock.fieldId}`]: intakeBlock.code },
			});
		}

		// Everything about the offer is acceptable: NOW the send counts against the ceiling. Two
		// checks rather than one `take` up front, so the race a `peek` leaves (a burst that passes the
		// peek together) still resolves to exactly `max` accepted sends.
		const taken = hireLimiter.take(owner);
		if (!taken.allowed) {
			return fail(429, {
				message: HIRE_RATE_LIMIT_MESSAGE,
				errors: { form: "rate_limited" },
				details: { retryAt: new Date(Date.now() + taken.retryAfterMs).toISOString() },
			});
		}

		// The terms as they will be RECORDED — the project's configured rates, or a placeholder on a
		// draft that has none yet. Resolved by the SSOT, never summed here.
		const offer = resolveHireOffer(brief, input);
		const sentMessage = offer.placeholder ? "Assignment staged." : "Invitation sent.";

		// LIVE: one `projects.invite_to_project` call per stage, each committing the row and routing the
		// `stage.invite` notification to the invitee through `comms.fn_notify` — the recipient's channel,
		// quiet-hours, mute and digest preferences are the router's to honour, in one transaction with the
		// row. The RPC re-derives `placeholder` and re-checks the cooldown; a refusal there is the
		// database's own sentence, passed through. A thrown live write is a 502, never a fall-through to
		// the stub (`liveWrite`): an invitation recorded in memory over a database that refused it would
		// be a send that never happened reported as one that did.
		const intro = input.message.trim();
		const live = await liveWrite<HireSent>(
			"hire",
			actor,
			input.projectId,
			sentMessage,
			async (a) => {
				const outcome = await insertInvitations(a, input, offer);
				if (outcome === null) return null;
				if ("refusal" in outcome) return outcome;
				return {
					data: {
						invites: outcome.data.invites,
						total: offer.totalCents ?? 0,
						placeholder: offer.placeholder,
						conversationId: intro
							? await postIntro(outcome.data.targetUserId, intro, outcome.data.projectId, a)
							: null,
					},
				};
			},
		);
		if (live !== undefined) {
			return live.ok ? { ...live, status: 201 } : live;
		}

		const invites = recordStubHireInvites(owner, brief, handle, offer);
		invalidateProjects(actor);
		// The stub twin of the request message: the intro lands in the pair's DM in the viewer's store.
		let conversationId: string | null = null;
		if (intro) {
			const sent = await MessagingBackendService.sendMessage(
				{
					conversationId: dmConversationId(handle),
					text: intro,
					delta: null,
					replyToId: null,
					attachmentIds: [],
					audio: null,
				},
				actor,
			);
			conversationId = sent.ok ? dmConversationId(handle) : null;
		}
		return ok(
			{ invites, total: offer.totalCents ?? 0, placeholder: offer.placeholder, conversationId },
			{ message: sentMessage, status: 201 },
		);
	}

	/**
	 * Invite a member already on the roster onto further stages — `POST /api/projects/members/stage-invite`.
	 * One pending invitation per stage at the stage's configured terms, through the same brief, refusal
	 * rule and `projects.invite_to_project` RPC the profile hire uses; the freelancer accepts or declines
	 * each. No intro message and no seller intake, because the member already joined once.
	 */
	static async inviteMemberToStages(
		input: StageInviteInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ invites: MemberInvite[] }>> {
		const denied = requireIdentity<{ invites: MemberInvite[] }>(actor, "invite someone to a stage");
		if (denied) return denied;
		const handle = input.handle.replace(/^@+/, "");

		const [briefRead, rosterRead] = await Promise.all([
			this.hireBrief(input.projectId, actor, handle),
			this.members({ projectId: input.projectId }, actor),
		]);
		if (!briefRead.ok || !briefRead.data) {
			return fail(briefRead.status, { message: briefRead.message });
		}
		if (!rosterRead.ok || !rosterRead.data) {
			return fail(rosterRead.status, { message: rosterRead.message });
		}
		const brief = briefRead.data.brief;
		const roster = rosterRead.data.page;
		const member = roster.members.find((m) =>
			(m.party.handle ?? "").replace(/^@+/, "").toLowerCase() === handle.toLowerCase()
		);
		const pending = new Set(
			member
				? memberStagePicture(member, roster.stages, roster.invites).pending.map((p) => p.stage.id)
				: [],
		);
		const refusal = stageInviteRefusal(brief, input, pending);
		if (refusal) return fail(422, { message: refusal.message, errors: refusal.errors });

		const hire = stageInviteAsHire(input);
		const offer = resolveHireOffer(brief, hire);
		const sentMessage = input.stageIds.length === 1
			? "Stage invitation sent."
			: "Stage invitations sent.";

		const live = await liveWrite<{ invites: MemberInvite[] }>(
			"inviteMemberToStages",
			actor,
			input.projectId,
			sentMessage,
			async (a) => {
				const outcome = await insertInvitations(a, hire, offer);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { invites: outcome.data.invites } };
			},
		);
		if (live !== undefined) return live.ok ? { ...live, status: 201 } : live;

		const invites = recordStubHireInvites(writeOwnerOf(actor), brief, handle, offer);
		invalidateProjects(actor);
		return ok({ invites }, { message: sentMessage, status: 201 });
	}

	// #region Stage & membership writes
	/**
	 * Append a stage — `POST /api/projects/[id]/stages`, the one write behind "Create stage" on the
	 * Board, the Timeline and the lane's Stages group.
	 *
	 * Live: `projects.create_stage` (owner-only, appended after the last `sort_order`, column defaults,
	 * its General room opened in the same transaction), then the stage is READ BACK through the board
	 * read so the caller receives it exactly as a reload will project it — its minted `stg-…` slug,
	 * status and lock included — rather than a second rendering assembled here.
	 *
	 * Stub: the stage is appended to the stored setup patch, the same store a setup save writes and the
	 * stub board, timeline and lane already fold, so it survives a reload in `dev:mock` too.
	 */
	static async createStage(
		slug: string,
		input: CreateStageInput,
		actor: ReadActor,
	): Promise<ServiceResult<CreatedStage>> {
		const denied = requireIdentity<CreatedStage>(actor, "add a stage");
		if (denied) return denied;
		const message = "Stage created.";

		const live = await liveWrite<MintedStage>(
			"createStage",
			actor,
			slug,
			message,
			(a) => createStageRow(a, slug, input),
		);
		if (live !== undefined) {
			if (!live.ok || !live.data) {
				return fail(live.status, {
					message: live.message,
					errors: live.errors,
					details: live.details,
				});
			}
			const stageId = live.data.stageId;
			const read = await this.createdBoardStage(slug, actor, (s) => s.id === stageId);
			return ok(
				{ stage: read ?? draftStageRef(stageId, input, 0) },
				{ message, status: 201 },
			);
		}

		const owner = writeOwnerOf(actor);
		const base = storedCreatedProject(owner, slug) ?? findProjectSetup(slug);
		if (!base) return noSuchProject(slug);
		const current = overlaySetup(base, actor);
		if (current.archivedAt) {
			return fail(409, { message: "This project is archived — no stage can be added to it." });
		}
		// What the BOARD held before the write, which is what "the new stage" is measured against — a
		// fixture's setup list and its board list are not always the same ids (Decision #139 flag (d)).
		const prior = await this.board({ projectId: slug, channelId: null, view: "stages" }, actor);
		const before = new Set(
			(prior.ok && prior.data ? prior.data.page.stages : current.stages).map((stage) => stage.id),
		);
		const patch: UpdateProject = {
			stages: [
				// Every existing stage by id alone: `setupPatchFrom` keeps each as stored and re-numbers
				// the order, so the new stage lands last without touching anything it did not name.
				...current.stages.map((stage) => ({ id: stage.id })),
				{
					name: input.name,
					description: input.description ? plainTextToHtml(input.description) : "",
				},
			],
		};
		mergeSetupPatch(owner, base, setupPatchFrom(patch, current));
		invalidateProjects(actor);
		const read = await this.createdBoardStage(slug, actor, (s) => !before.has(s.id));
		const stage = read ?? draftStageRef(mintStageId(), input, current.stages.length);
		// The board card prints the plain brief; the stored copy is the setup surface's rich text.
		return ok({ stage: { ...stage, description: input.description } }, { message, status: 201 });
	}

	/** The project board's stage that `match` selects, or `null` when the re-read could not find it. */
	private static async createdBoardStage(
		slug: string,
		actor: ReadActor,
		match: (stage: BoardStageRef) => boolean,
	): Promise<BoardStageRef | null> {
		const read = await this.board({ projectId: slug, channelId: null, view: "stages" }, actor);
		return read.ok && read.data ? read.data.page.stages.find(match) ?? null : null;
	}

	/**
	 * Invite people to the engagement (or one stage of it) — `POST /api/projects/[id]/invites`, the
	 * Members tab's Invite modal.
	 *
	 * Each address is one invitation, sent in order: an `@handle` through `invite_to_project`
	 * (identity-addressed, answered in-app, the 48-day decline cooldown enforced in the database), an
	 * email through `invite_by_email` (kept email-addressed, so the inviter never learns whose account
	 * an address belongs to). Both notify the invitee with `stage.invite` in the same transaction.
	 *
	 * The outbound ceiling is the Hire flow's (`HIRE_RATE_LIMIT`, 10 per sliding 10 minutes, keyed by
	 * the acting identity) — one allowance, whichever surface spends it. Peeked before each address and
	 * taken only once the database accepted it, so a refused address does not cost the next one.
	 *
	 * A refusal on one address does not unsend the others: the answer lists what was issued and what
	 * was refused, each with the database's own sentence. Only when NOTHING was issued is the whole
	 * send a failure, carrying the first refusal's status.
	 */
	static async inviteMember(
		slug: string,
		input: InviteProjectMemberInput,
		actor: ReadActor,
	): Promise<ServiceResult<InvitesSent>> {
		const denied = requireIdentity<InvitesSent>(actor, "invite someone to a project");
		if (denied) return denied;
		const owner = writeOwnerOf(actor);
		const ceiling = hireLimiter.peek(owner);
		if (!ceiling.allowed) return rateLimited(ceiling.retryAfterMs);

		const live = await liveWrite<InvitesSent>(
			"inviteMember",
			actor,
			slug,
			"Invitations sent.",
			async (a) => {
				const target = await resolveInviteTarget(a, slug);
				if (!target) return null;
				const issued: string[] = [];
				const refused: InviteRefusal[] = [];
				let first: WriteRefusal | null = null;
				for (const address of input.addresses) {
					const slot = hireLimiter.peek(owner);
					if (!slot.allowed) {
						first ??= rateLimitRefusal(slot.retryAfterMs);
						refused.push({ address, message: HIRE_RATE_LIMIT_MESSAGE, code: "rate_limited" });
						continue;
					}
					const outcome = await issueInvitation(a, target, address, input.role, input.stageId);
					if ("refusal" in outcome) {
						first ??= outcome.refusal;
						refused.push({
							address,
							message: outcome.refusal.message,
							code: refusalCode(outcome.refusal),
						});
						continue;
					}
					hireLimiter.take(owner);
					issued.push(outcome.data);
				}
				if (issued.length === 0 && first) return { refusal: first };
				return { data: { invites: await readIssuedInvitations(a, target, issued), refused } };
			},
		);
		if (live !== undefined) {
			if (!live.ok || !live.data) return live;
			return ok(live.data, { message: invitesSentMessage(live.data), status: 201 });
		}

		const page = this.stubRoster(slug, actor);
		if (!page) return noSuchProject(slug);
		const stage = input.stageId ? page.stages.find((s) => s.id === input.stageId) ?? null : null;
		if (input.stageId && !stage) {
			return fail(422, {
				message: "That stage is not part of this project.",
				errors: { stageId: "unknown_stage" },
			});
		}
		// The cooldown counts from a decline whether or not the client dismissed it, as the database does.
		const history = overlayMemberRoster(
			findMemberRoster({ projectId: slug }) ?? createdMemberRoster(slug, actor) ?? page,
			actor,
			{ keepDismissed: true },
		).invites;
		const nowMs = Date.now();
		const base = hireInviteCount(owner, page.projectId);
		const sent: MemberInvite[] = [];
		const refused: InviteRefusal[] = [];
		let first: { status: number; message: string; code: string } | null = null;
		for (const address of input.addresses) {
			const refusal = stubInviteRefusal(page, history, address, input.stageId, nowMs, owner);
			if (refusal) {
				first ??= refusal;
				refused.push({ address, message: refusal.message, code: refusal.code });
				continue;
			}
			hireLimiter.take(owner);
			const handle = address.startsWith("@") ? address : null;
			sent.push({
				// Its own `-sent-` namespace: the fixture corpus mints `{slug}-inv-N` and the Hire flow
				// `{slug}-hire-N`, and an id that collides with either is folded away as already present.
				id: `${page.projectId}-sent-${base + sent.length + 1}`,
				email: address,
				handle,
				role: input.role,
				stageId: stage?.id ?? null,
				stageName: stage?.name ?? null,
				invitedBy: "You",
				invitedAt: new Date(nowMs).toISOString(),
				invitedLabel: "Just now",
				status: "pending",
			});
		}
		if (sent.length === 0 && first) {
			return fail(first.status, { message: first.message, errors: { addresses: first.code } });
		}
		appendHireInvites(owner, page.projectId, sent);
		invalidateProjects(actor);
		const data = { invites: sent, refused };
		return ok(data, { message: invitesSentMessage(data), status: 201 });
	}

	/**
	 * The project's invitation queue — `GET /api/projects/[id]/invites`. The roster read's own queue,
	 * so the list a managing viewer sees here and in the Invitations section is one read; a viewer the
	 * roster withholds the queue from gets an empty list rather than a different answer.
	 */
	static async listInvites(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ invites: MemberInvite[] }>> {
		const read = await this.members({ projectId: slug }, actor);
		if (!read.ok || !read.data) return fail(read.status, { message: read.message });
		return ok({ invites: read.data.page.invites });
	}

	/**
	 * Change one participant's role — `PATCH /api/projects/[id]/members/[memberId]/role`, the Members
	 * tab's Change role dialog.
	 *
	 * Live: `projects.set_member_role` — review authority (the owner, or a client-business member), the
	 * caller's own row and the owner seat refused, `freelancer` stored as the `assignee` an accepted
	 * invitation writes, and the change audited in `security.audit_logs` in the same transaction. A
	 * role is a permission label only: no seat, ticket or escrow moves (that is `removeMember`).
	 */
	static async updateMemberRole(
		slug: string,
		memberId: string,
		role: AssignableMemberRole,
		actor: ReadActor,
	): Promise<ServiceResult<MemberRoleChanged>> {
		const denied = requireIdentity<MemberRoleChanged>(actor, "change a member's role");
		if (denied) return denied;

		const live = await liveWrite<MemberRoleChanged>(
			"updateMemberRole",
			actor,
			memberId,
			"Role updated.",
			async (a) => {
				const outcome = await setMemberRoleRow(a, slug, memberId, role);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { memberId, role: outcome.data.role, changed: outcome.data.changed } };
			},
			"member",
		);
		if (live !== undefined) return live;

		const page = this.stubRoster(slug, actor);
		if (!page) return noSuchProject(slug);
		const row = page.members.find((m) => m.id === memberId);
		if (!row) return notFound("member", memberId);
		if (row.isViewer) {
			return fail(422, {
				message: "You cannot change your own role.",
				errors: { role: "not_allowed" },
			});
		}
		if (row.role === "owner" || row.role === "client") {
			return fail(409, {
				message: "The client side of the engagement has no role to change.",
				errors: { memberId: "client_side" },
			});
		}
		const changed = row.role !== role;
		if (changed) {
			recordRoleChange(writeOwnerOf(actor), page.projectId, memberId, role);
			invalidateProjects(actor);
		}
		return ok({ memberId, role, changed }, { message: "Role updated." });
	}
	// #endregion

	/**
	 * A freelancer applies to a stage (optionally one of its staffing roles) of a live project —
	 * `POST /api/projects/apply`, the inbound half of the handshake. The application is recorded
	 * `pending` and the owner notified (`application.received`) by `projects.apply_to_project`; a
	 * cover note is then posted as the opening message of the request, in the owner's Requests folder.
	 */
	static async apply(
		input: ApplyToProject,
		actor: ReadActor,
	): Promise<ServiceResult<ProjectApplication>> {
		const denied = requireIdentity<ProjectApplication>(actor, "apply to a project");
		if (denied) return denied;
		const note = input.message.trim();

		const live = await liveWrite<ProjectApplication>(
			"apply",
			actor,
			input.projectId,
			"Application sent.",
			async (a) => {
				const outcome = await applyLive(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				const row = outcome.data;
				return {
					data: {
						id: row.id,
						projectId: row.projectSlug,
						stageId: row.stageId,
						roleId: row.roleId,
						status: "pending",
						message: row.message,
						conversationId: note ? await postIntro(row.ownerUserId, note, row.projectId, a) : null,
					},
				};
			},
		);
		if (live !== undefined) return live.ok ? { ...live, status: 201 } : live;

		const project = findProject(input.projectId);
		if (!project) return fail(404, { message: `No project found for "${input.projectId}".` });
		if (hasOpenStubApplication(actor, project.slug, input.stageId, input.roleId)) {
			return fail(409, {
				message: "You already have a pending application here.",
				errors: { stageId: "duplicate" },
			});
		}
		const masked = note ? maskPii(note).masked : null;
		const row = recordStubApplication(
			actor,
			{ projectId: project.slug, stageId: input.stageId, roleId: input.roleId, message: masked },
			Date.now(),
		);
		return ok(
			{
				id: row.id,
				projectId: project.slug,
				stageId: row.stageId,
				roleId: row.roleId,
				status: "pending",
				message: masked,
				conversationId: null,
			},
			{ message: "Application sent.", status: 201 },
		);
	}

	/**
	 * The invitee answers a request: every invitation named is accepted or declined through
	 * `projects.respond_to_project_invitation` (`POST /api/projects/invites/respond`). A multi-stage
	 * hire is one request to the person receiving it, so the drawer answers its invitations together;
	 * they are answered in sequence and the first refusal stops the rest, reported as such.
	 */
	static async respondToInvitations(
		input: RespondToInvitation,
		actor: ReadActor,
	): Promise<ServiceResult<InvitationAnswered>> {
		const denied = requireIdentity<InvitationAnswered>(actor, "answer an invitation");
		if (denied) return denied;
		const verb = input.accept ? "accepted" : "declined";

		const live = await liveWrite<InvitationAnswered>(
			"respondToInvitations",
			actor,
			input.invitationIds[0],
			input.accept ? "Request accepted." : "Request declined.",
			async (a) => {
				const answered: InvitationAnswered["answered"] = [];
				for (const id of input.invitationIds) {
					const outcome = await respondLive(a, id, input.accept);
					if (outcome === null) return answered.length > 0 ? { data: { answered } } : null;
					if ("refusal" in outcome) return answered.length > 0 ? { data: { answered } } : outcome;
					answered.push(outcome.data);
				}
				return { data: { answered } };
			},
			"invitation",
		);
		if (live !== undefined) return live;

		for (const id of input.invitationIds) recordRequestDecision(id, verb);
		return ok(
			{ answered: input.invitationIds.map((id) => ({ id, status: verb })) },
			{ message: input.accept ? "Request accepted." : "Request declined." },
		);
	}

	/**
	 * The client confirms an applicant's seat (`POST /api/projects/applications/accept`) through
	 * `projects.assign_from_application` — conflict-guarded against double-booking, and the applicant
	 * is told with `application.accepted`. The answer names where the seat is funded.
	 */
	static async acceptApplication(
		input: AcceptApplication,
		actor: ReadActor,
	): Promise<ServiceResult<ApplicationAccepted>> {
		const denied = requireIdentity<ApplicationAccepted>(actor, "confirm a seat");
		if (denied) return denied;
		const done: ApplicationAccepted = {
			id: input.applicationId,
			status: "accepted",
			fundHref: "/wallet#upcoming",
		};

		const live = await liveWrite<ApplicationAccepted>(
			"acceptApplication",
			actor,
			input.applicationId,
			"Seat confirmed.",
			async (a) => {
				const outcome = await acceptApplicationLive(a, input.applicationId);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: done };
			},
			"application",
		);
		if (live !== undefined) return live;

		// A fixture request seats its applicant on the stub roster, as `assign_from_application` enrols
		// them as a participant on the live one; any other id is a request the drawer answered.
		const fixture = findFixtureRequest(input.applicationId);
		if (fixture && requestDecisionOf(input.applicationId) === null) {
			recordApplicationSeat(
				writeOwnerOf(actor),
				fixture.projectId,
				stubSeatFromRequest(fixture.projectId, fixture.request, Date.now()),
			);
		}
		recordRequestDecision(input.applicationId, "accepted");
		return ok(done, { message: "Seat confirmed." });
	}

	/**
	 * The client declines an applicant (`POST /api/projects/applications/reject`) through
	 * `projects.reject_application` — the application becomes `rejected` and the applicant is told
	 * with `application.declined`. Nothing else moves: no seat was taken, so nothing is released.
	 */
	static async rejectApplication(
		input: RejectApplication,
		actor: ReadActor,
	): Promise<ServiceResult<ApplicationRejected>> {
		const denied = requireIdentity<ApplicationRejected>(actor, "decline an applicant");
		if (denied) return denied;
		const done: ApplicationRejected = { id: input.applicationId, status: "rejected" };

		const live = await liveWrite<ApplicationRejected>(
			"rejectApplication",
			actor,
			input.applicationId,
			"Application declined.",
			async (a) => {
				const outcome = await rejectApplicationLive(a, input.applicationId);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: done };
			},
			"application",
		);
		if (live !== undefined) return live;

		if (requestDecisionOf(input.applicationId) !== null) {
			return fail(409, {
				message: "This application has already been answered.",
				errors: { applicationId: "answered" },
			});
		}
		recordRequestDecision(input.applicationId, "declined");
		return ok(done, { message: "Application declined." });
	}

	/**
	 * The owner's editable configuration for one engagement, plus its derived setup ladder — the
	 * Details half of `/projects/[projectId]` and the progress bar in its header band.
	 *
	 * `steps`, `completeness` and `previewReady` are computed by `reconcileSetup` on both sides of
	 * the gate, so the bar the owner reads and the gate that unlocks Preview can never disagree about
	 * the same project. They are never accepted from a client (root CLAUDE.md §6).
	 */
	static async setup(
		slug: string,
		actor: ReadActor,
		/**
		 * A DEV-ONLY onboarding simulation from the Context Switcher, or absent.
		 *
		 * Deliberately not applied to the live branch below. It decides what a client may still edit,
		 * and a switch on somebody's own machine must not be able to tell a real database that a real
		 * freelancer does or does not exist. `effectiveOnboardingSim` discards it outside development
		 * as a second line, so a stray query param on a deployed instance changes nothing.
		 */
		sim?: OnboardingSim,
	): Promise<ServiceResult<{ setup: ProjectSetup }>> {
		const live = await liveRead(
			"setup",
			actor,
			"projects.setup",
			{ slug },
			(a) => fetchProjectSetup(a, slug),
		);
		if (live !== undefined) {
			if (!live) return noSuchProject(slug);
			return ok({ setup: live });
		}
		// A project this viewer minted through the stub create has no fixture underneath it, so it is
		// resolved before the corpus is consulted. Without this branch the Quick-Init modal navigates to
		// a real id and lands on a 404 — a create that reported success and produced nothing openable.
		const simulate = effectiveOnboardingSim(sim);
		const created = storedCreatedProject(writeOwnerOf(actor), slug);
		if (created) {
			return ok({ setup: applyOnboardingSim(overlaySetup(created, actor), simulate) });
		}

		const setup = findProjectSetup(slug);
		if (!setup) return noSuchProject(slug);
		return ok({ setup: applyOnboardingSim(overlaySetup(setup, actor), simulate) });
	}

	/**
	 * The member dashboard for one engagement — the half of `/projects/[projectId]` a viewer who is
	 * not the client sees: the hero, recent updates, channel quick-entries, their own assignments and
	 * their own money position.
	 *
	 * The finance block is VIEWER-PERTINENT and server-computed. It answers what this person is owed
	 * on this project and never what the project is worth, and every figure arrives as a `MoneyView`
	 * so the client renders a string rather than totalling anything itself.
	 */
	static async overview(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ overview: ProjectOverview }>> {
		const live = await liveRead(
			"overview",
			actor,
			"projects.overview",
			{ slug },
			(a) => fetchProjectOverview(a, slug),
		);
		if (live !== undefined) {
			if (!live) return noSuchProject(slug);
			return ok({ overview: live });
		}
		const found = findProjectOverview(slug);
		if (!found) return noSuchProject(slug);
		// Every identifier the project answers to, because an archive recorded through one address must
		// hide it through the other — otherwise a soft-deleted project stays openable on half its links.
		if (isStoredArchived(actor, found.id, found.slug, slug)) return noSuchProject(slug);
		return ok({ overview: overlayOverview(found, slug, actor) });
	}

	/**
	 * The engagement's Overview — `/projects/[slug]` for the owner and every participant (Decision
	 * #144): the base {@link overview} plus "Needs you", the stage run and the people.
	 *
	 * COMPOSED from reads this service already answers on both branches rather than queried afresh:
	 * the overview, the board (the run and every ticket's state), the roster (people and open
	 * applications) and — for the owner only, who alone is shown prices — the setup. The composition is
	 * the pure `composeWorkspace`, so the live path and the stub path cannot disagree about what a
	 * "submission waiting for review" or a "stage that needs a price" is.
	 *
	 * The base read is the gate: its miss is this read's miss. Every other source degrades on its own —
	 * a board or roster that fails arrives as `null`, and that part of the page reads as unknown rather
	 * than as a confident zero. Kept separate from {@link overview} so a link preview and
	 * `/api/projects/overview`, which need the hero alone, do not pay for three more reads.
	 */
	static async workspace(
		slug: string,
		actor: ReadActor,
		viewer: WorkspaceViewer,
	): Promise<ServiceResult<{ workspace: ProjectWorkspace }>> {
		const base = await ProjectBackendService.overview(slug, actor);
		if (!base.ok || !base.data) {
			return fail(base.status || 404, {
				message: base.message ?? `No project found for "${slug}".`,
			});
		}

		const [board, roster, setup] = await Promise.all([
			ProjectBackendService.board({ projectId: slug }, actor),
			ProjectBackendService.members({ projectId: slug }, actor),
			viewer === "owner" ? ProjectBackendService.setup(slug, actor) : Promise.resolve(null),
		]);

		return ok({
			workspace: composeWorkspace(base.data.overview, {
				viewer,
				board: board.ok && board.data ? board.data.page : null,
				roster: roster.ok && roster.data ? roster.data.page : null,
				setup: setup && setup.ok && setup.data ? setup.data.setup : null,
			}),
		});
	}

	/**
	 * Save the setup form — the PUT/PATCH behind the Details surface.
	 *
	 * Returns the RE-DERIVED configuration rather than echoing the payload, because the ladder and
	 * the percentage are functions of what is now stored: echoing would report a completeness the
	 * project does not have, and the footer's dirty state is measured against this response
	 * (Decision #61), so an echo would also leave the form permanently dirty after a successful save.
	 */
	static async updateProject(
		slug: string,
		input: UpdateProject,
		actor: ReadActor,
		/**
		 * Whether this is a FULL replace (`PUT`) rather than a merge (`PATCH`).
		 *
		 * It decides one thing and it is the destructive one: whether a stage or role the payload does
		 * not mention is DELETED. A PATCH sends the section that changed, so treating an absent stage
		 * as a removal turns a title-only save into a pipeline wipe — and deleting a stage releases its
		 * escrow. Only a caller who said "here is the whole resource" gets that.
		 */
		replace = false,
		/**
		 * The same DEV-ONLY simulation the read takes, and it has to be here or the two halves
		 * disagree: the form would draw a lock the write then allowed, or refuse a field the form left
		 * open. Ignored on the live branch and outside development, exactly as on the read.
		 */
		sim?: OnboardingSim,
	): Promise<ServiceResult<{ setup: ProjectSetup }>> {
		const denied = requireIdentity<{ setup: ProjectSetup }>(actor, "edit this project");
		if (denied) return denied;

		const live = await liveWrite<{ setup: ProjectSetup }>(
			"updateProject",
			actor,
			slug,
			"Project saved.",
			async (a) => {
				const outcome = await applyProjectUpdate(a, slug, input, replace);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { setup: outcome.data } };
			},
		);
		if (live) return live;

		const owner = writeOwnerOf(actor);
		// A stub-created draft has no fixture underneath it, so it is resolved first — without this the
		// Quick-Init draft the owner just landed on would refuse its own first save with a 404.
		const base = storedCreatedProject(owner, slug) ?? findProjectSetup(slug);
		if (!base) return noSuchProject(slug);
		// The CURRENT stored configuration — the fixture plus every edit this process has accumulated —
		// not the bare fixture. It is what `setupPatchFrom` diffs against, and it is what the locks must
		// be judged against too: a rule evaluated on a stale base would freeze a price the owner had
		// already legitimately changed a moment earlier.
		// Simulated the same way the read simulated it, so the locks the form is drawing and the locks
		// this guard applies are computed from one projection rather than two.
		const simulate = effectiveOnboardingSim(sim);
		const current = applyOnboardingSim(overlaySetup(base, actor), simulate);
		// The same guard the live path runs, on the same rule, from the same module. A second
		// implementation here would let the two paths disagree about what is frozen — and since this is
		// the path that runs with the backend gate off, the disagreement would be the default.
		if (touchesLockableFields(input)) {
			const locked = onboardingLockRefusal(input, lockStateOf(current));
			if (locked) {
				return fail(locked.status, { message: locked.message, errors: locked.errors });
			}
		}
		// Keyed by the project's own identity rather than by the routed segment: the same project reached
		// through its slug and through its uuid must accumulate ONE set of edits, not two.
		const merged = mergeSetupPatch(owner, base, setupPatchFrom(input, current));
		invalidateProjects(actor);
		// The response is simulated too, and it has to be: the form adopts what comes back as its new
		// clean baseline, so an unsimulated response would silently drop the simulation on the first
		// save and flip every lock back mid-session — with nothing to say why.
		return ok(
			{ setup: applyOnboardingSim(reconcileSetup(base, merged), simulate) },
			{ message: "Project saved." },
		);
	}

	/**
	 * Archive an engagement — the DELETE, which is a soft archive and never a row removal
	 * (root CLAUDE.md §5).
	 *
	 * Idempotent: archiving an already-archived project returns the ORIGINAL instant rather than
	 * restamping it, so a double-press or a retry after an unseen timeout cannot rewrite when the
	 * decision was taken.
	 */
	static async archiveProject(
		slug: string,
		input: ArchiveProject,
		actor: ReadActor,
	): Promise<ServiceResult<{ slug: string; archivedAt: string }>> {
		type Archived = { slug: string; archivedAt: string };
		const denied = requireIdentity<Archived>(actor, "archive this project");
		if (denied) return denied;

		const live = await liveWrite<Archived>(
			"archiveProject",
			actor,
			slug,
			"Project archived.",
			(a) => archiveProjectRow(a, slug, input),
		);
		if (live) return live;

		const owner = writeOwnerOf(actor);
		const target = storedCreatedProject(owner, slug) ?? findProjectSetup(slug);
		if (!target) return noSuchProject(slug);
		const archivedAt = recordProjectArchive(owner, target, new Date().toISOString());
		invalidateProjects(actor);
		return ok({ slug: target.slug, archivedAt }, { message: "Project archived." });
	}

	/**
	 * Create or update one ticket, and return the card the board renders.
	 *
	 * The returned `id` is always SERVER-minted. The composer sends its own optimistic id so the
	 * answer can be reconciled against the card it spliced in, and echoing that id back would leave
	 * the board holding a key no later write could address.
	 *
	 * Two of `projects.tickets`' eleven triggers are mirrored here so the stub refuses exactly what
	 * the database refuses. A rule enforced on only one side of the gate is a rule whose violations
	 * appear the day the gate flips, in a save that was working the day before.
	 */
	static async commitTicket(
		input: CommitTicket,
		actor: ReadActor,
	): Promise<ServiceResult<{ card: BoardCard }>> {
		const denied = requireIdentity<{ card: BoardCard }>(actor, "save a ticket");
		if (denied) return denied;

		const live = await liveWrite<{ card: BoardCard }>(
			"commitTicket",
			actor,
			input.projectId,
			"Ticket saved.",
			async (a) => {
				const outcome = await commitTicketRow(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				// Evicted the moment the row lands, not after the read-back. The ticket exists from here
				// on whatever happens next, so a re-read that fails must still leave the cache holding
				// nothing rather than the board as it was before the ticket was created.
				invalidateProjects(a);
				const page = await fetchBoardPage(a, { projectId: input.projectId, view: "stages" });
				const card = page?.cards.find((c) => c.id === outcome.data);
				// The board is re-read rather than a second card assembled here: composing one needs the
				// ticket's history, submissions, attachments and money trail, and a second assembler is a
				// second answer to what a ticket costs.
				if (!card) return { refusal: { status: 502, message: "Ticket saved but not readable." } };
				return { data: { card } };
			},
		);
		if (live) return live;

		const board = findBoardPage({ projectId: input.projectId, view: "stages" });
		if (!board) return noSuchProject(input.projectId);
		const page = overlayBoardPage(board, actor);
		// Overlaid, like its sibling reads. The base fixture has `allowDeadlineBonuses: false`, so
		// reading it raw meant an owner could turn deadline bonuses on, see the toggle stay on, and have
		// every due date refused anyway — the write they had just made was invisible to the check.
		const base = findProjectSetup(input.projectId);
		const setup = base ? overlaySetup(base, actor) : null;

		// `fn_enforce_ticket_due_date` RAISES when a due date is set on a project that has not agreed
		// to deadline bonus terms. Refusing with the reason is the difference between a form the owner
		// can correct and a save that aborts with nothing to act on.
		if (input.dueDate && setup && !setup.rules.allowDeadlineBonuses) {
			return fail(422, {
				message: "Turn on deadline bonuses for this project before setting a ticket due date.",
				errors: { dueDate: "deadline_bonuses_disabled" },
			});
		}
		// `fn_enforce_ticket_checkout_desc` RAISES on entering `claimed`/`in_progress` with an empty
		// description — the purchasing gate (PRODUCT_SPEC §Creation & Purchasing Gate), enforced in the
		// database as well as in the composer.
		const claiming = input.status === "claimed" || input.status === "in_progress";
		if (claiming && input.description.trim().length === 0) {
			return fail(422, {
				message: "Describe the work before it can be claimed.",
				errors: { description: "description_required" },
			});
		}

		const owner = writeOwnerOf(actor);
		const existing = storedTicketCard(owner, input.projectId, input.clientId) ??
			page.cards.find((card) => card.id === input.clientId);
		const id = existing?.id ?? mintTicketId();
		const card = buildStubCard(input, page.stages, existing, id, Date.now());
		putTicketCard(owner, input.projectId, card);
		invalidateProjects(actor);
		return ok({ card }, { message: "Ticket saved." });
	}

	/**
	 * Move one ticket between board columns.
	 *
	 * The live path goes through `projects.move_ticket` and NEVER a status column write, because
	 * `trg_ticket_escrow_sync` fires on one: a plain `UPDATE ... SET status = 'completed'` releases
	 * escrow to the freelancer. Status is a money-moving column, and `move_ticket` is where the
	 * delivery-authority check and the audit row live.
	 *
	 * The stub moves the card and moves no money. Nothing here may flip `escrowHeld` or write a
	 * payment line, because a ledger with no transaction behind it is worse than no ledger.
	 */
	static async moveTicket(
		input: MoveTicket,
		actor: ReadActor,
	): Promise<ServiceResult<{ card: BoardCard }>> {
		const denied = requireIdentity<{ card: BoardCard }>(actor, "move a ticket");
		if (denied) return denied;

		const live = await liveWrite<{ card: BoardCard }>(
			"moveTicket",
			actor,
			input.ticketId,
			"Ticket moved.",
			async (a) => {
				const outcome = await moveTicketRow(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				// The move has committed — and it may have released escrow through
				// `trg_ticket_escrow_sync`. Evict before the read-back so a failed re-read cannot leave a
				// board cached in the column the ticket has already left.
				invalidateProjects(a);
				const page = await fetchBoardPage(a, { projectId: input.projectId, view: "stages" });
				const card = page?.cards.find((c) => c.id === outcome.data);
				if (!card) return { refusal: { status: 502, message: "Ticket moved but not readable." } };
				return { data: { card } };
			},
			"ticket",
		);
		if (live) return live;

		const board = findBoardPage({ projectId: input.projectId, view: "stages" });
		if (!board) return noSuchProject(input.projectId);
		const owner = writeOwnerOf(actor);
		const page = overlayBoardPage(board, actor);
		const current = storedTicketCard(owner, input.projectId, input.ticketId) ??
			page.cards.find((card) => card.id === input.ticketId);
		if (!current) return fail(404, { message: "That ticket is no longer on this board." });

		const card = movedStubCard(current, input, Date.now());
		putTicketCard(owner, input.projectId, card);
		invalidateProjects(actor);
		return ok({ card }, { message: "Ticket moved." });
	}

	/**
	 * Post one message into a project channel.
	 *
	 * Attachments arrive as `files.items` ids, never as bytes: the device upload already went through
	 * the files handshake before this call, which is why `/api/files/upload-init` exists. An
	 * application route is not a file transport.
	 *
	 * A reply's original is resolved on both branches under the same rule — a message of THIS channel,
	 * or the one `replyRefusal` (422 on `replyToId`). The stub looks in the channel's whole fixture
	 * history and then in the viewer's own sent overlay, which together are everything the stub feed
	 * can show; a system notice is not repliable, having no live counterpart to point at.
	 */
	static async sendMessage(
		input: SendProjectMessage,
		actor: ReadActor,
	): Promise<ServiceResult<{ message: ChatMessage }>> {
		const denied = requireIdentity<{ message: ChatMessage }>(actor, "send a message");
		if (denied) return denied;

		const live = await liveWrite<{ message: ChatMessage }>(
			"sendMessage",
			actor,
			input.channelId,
			"Message sent.",
			async (a) => {
				const outcome = await insertProjectMessage(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { message: outcome.data } };
			},
			"channel",
		);
		if (live) return live;

		const page = findMessagePage({ projectId: input.projectId, channelId: input.channelId });
		if (!page) return fail(404, { message: "No such project channel." });

		const owner = writeOwnerOf(actor);
		const replyTo = input.replyToId === null ? null : replyFromMessage(
			findChannelMessage(input.projectId, input.channelId, input.replyToId) ??
				findSentMessage(owner, input.projectId, input.channelId, input.replyToId),
		);
		if (input.replyToId !== null && !replyTo) {
			const refusal = replyRefusal();
			return fail(refusal.status, { message: refusal.message, errors: refusal.errors });
		}
		const message = buildStubMessage(
			input,
			viewerSenderFor(input.projectId, input.channelId),
			sentMessageCount(owner, input.projectId, input.channelId),
			Date.now(),
			replyTo,
		);
		appendChannelMessage(owner, input.projectId, input.channelId, message);
		invalidateProjects(actor);
		return ok({ message }, { message: "Message sent." });
	}

	/**
	 * Create one submission unit against a stage.
	 *
	 * `submit` is the whole difference between two outcomes. A draft is editable and makes no
	 * delivery claim; `pending_review` starts the reviewer's clock. Conflating them would tell a
	 * client that work is waiting on them which the freelancer has not finished.
	 */
	static async createSubmission(
		input: CreateSubmission,
		actor: ReadActor,
	): Promise<ServiceResult<{ unit: SubmissionUnit }>> {
		const denied = requireIdentity<{ unit: SubmissionUnit }>(actor, "create a submission");
		if (denied) return denied;

		const live = await liveWrite<{ unit: SubmissionUnit }>(
			"createSubmission",
			actor,
			input.stageId,
			input.submit ? "Submitted for review." : "Draft saved.",
			async (a) => {
				const outcome = await insertSubmission(a, input);
				if (outcome === null || "refusal" in outcome) return outcome;
				return { data: { unit: outcome.data } };
			},
			"stage",
		);
		if (live) return live;

		const detail = findProjectDetail(input.projectId);
		if (!detail) return noSuchProject(input.projectId);
		const stage = detail.channels.stages.find((s) => s.id === input.stageId);

		const owner = writeOwnerOf(actor);
		const unit = buildStubSubmissionUnit(
			input,
			viewerSenderFor(input.projectId, input.channelId),
			stage?.name ?? null,
			submissionCount(owner, input.projectId) + 1,
			Date.now(),
		);
		// Sending a draft that already exists is a transition here too, exactly as it is live: appending
		// would leave the freelancer looking at their delivery twice, once as a draft they can no longer
		// send and once as the submission.
		const sent = input.submit && input.submissionId
			? submitStoredSubmission(owner, input.projectId, input.submissionId, {
				...unit,
				path: [...unit.path.slice(0, -1), input.submissionId],
			})
			: null;
		if (!sent) {
			appendSubmission(owner, input.projectId, {
				unit,
				stageId: input.stageId,
				channelId: input.channelId,
			});
		}
		invalidateProjects(actor);
		return ok({ unit: sent?.unit ?? unit }, {
			status: sent ? 200 : 201,
			message: input.submit ? "Submitted for review." : "Draft saved.",
		});
	}

	// #region Stage settlement
	/**
	 * Record a reviewer's verdict on one submission (`projects.review_submission`).
	 *
	 * `accept` marks the deliverable accepted; `request_revision` records the notes as a formal
	 * revision request and returns the ticket to In Progress. Review authority is the FUNCTION's check
	 * (owner or active client-business member); a freelancer, including the submitter, is refused 403.
	 *
	 * The stub records the verdict over the unit and moves nothing else — no revision request, no
	 * ticket move — because those are rows the live read derives and the fixture read does not.
	 */
	static async reviewSubmission(
		input: ReviewSubmission,
		actor: ReadActor,
	): Promise<ServiceResult<SubmissionReviewed>> {
		const denied = settlementDenied<SubmissionReviewed>(actor, "review a submission");
		if (denied) return denied;

		const live = await liveWrite<SubmissionReviewed>(
			"reviewSubmission",
			actor,
			input.submissionId,
			input.decision === "accept" ? "Submission accepted." : "Revision requested.",
			(a) => reviewSubmissionRow(a, input),
			"submission",
		);
		if (live) return live;

		if (!findProjectDetail(input.projectId)) return noSuchProject(input.projectId);
		const status = input.decision === "accept" ? "accepted" : "revision_requested";
		recordStubReview(writeOwnerOf(actor), input.projectId, input.submissionId, status);
		invalidateProjects(actor);
		return ok(
			{ submissionId: input.submissionId, stageId: input.stageId, status },
			{ message: input.decision === "accept" ? "Submission accepted." : "Revision requested." },
		);
	}

	/**
	 * Approve a stage and release every held escrow on it (`projects.approve_stage`).
	 *
	 * The stage settles straight to `paid` — release and settlement are one transaction — and when it
	 * was the project's last unsettled stage the Contact Handover fires. Only the client/owner may do
	 * this; the function refuses anyone else 403 before any money moves.
	 *
	 * The stub moves no money, so it reports zero released rather than inventing a payout figure. A
	 * ledger line with no transaction behind it is worse than an honest zero.
	 */
	static async approveStage(
		input: ApproveStage,
		actor: ReadActor,
	): Promise<ServiceResult<StageApproved>> {
		const denied = settlementDenied<StageApproved>(actor, "approve a stage");
		if (denied) return denied;

		const live = await liveWrite<StageApproved>(
			"approveStage",
			actor,
			input.stageId,
			"Stage approved — escrow released.",
			(a) => approveStageRow(a, input),
			"stage",
		);
		if (live) return live;

		if (!findProjectDetail(input.projectId)) return noSuchProject(input.projectId);
		return ok({
			stageId: input.stageId,
			status: "paid",
			releasedCount: 0,
			totalPaidCents: 0,
			feeCents: 0,
			handoverUnlocked: false,
		}, { message: "Stage approved (simulated — no escrow moved)." });
	}

	/**
	 * Cancel a stage under the Fair Exit split (`projects.cancel_stage_fair_exit`): the freelancer is
	 * paid `tier`% of each held escrow, net of the fee, and the remainder is refunded to the payer.
	 * Client/owner only, refused 403 by the function for anyone else.
	 */
	static async cancelStageFairExit(
		input: CancelStageFairExit,
		actor: ReadActor,
	): Promise<ServiceResult<StageExited>> {
		const denied = settlementDenied<StageExited>(actor, "cancel a stage");
		if (denied) return denied;

		const live = await liveWrite<StageExited>(
			"cancelStageFairExit",
			actor,
			input.stageId,
			"Stage cancelled — the Fair Exit split was settled.",
			(a) => exitStageRow(a, input),
			"stage",
		);
		if (live) return live;

		if (!findProjectDetail(input.projectId)) return noSuchProject(input.projectId);
		return ok({
			stageId: input.stageId,
			status: "cancelled",
			tier: input.tier,
			cancelledCount: 0,
			freelancerPaidCents: 0,
			clientRefundedCents: 0,
		}, { message: "Stage cancelled (simulated — no escrow moved)." });
	}
	// #endregion

	/**
	 * Mint a draft engagement from the Quick-Init modal, and return BOTH its identifiers.
	 *
	 * The client navigates to `id`. That is the whole reason this returns a pair: a title-derived slug
	 * moves on the first rename, so a URL built on it dies the moment the owner edits the title — and
	 * the very next thing the owner does on the Stage-2 surface is write a real title.
	 *
	 * Both branches produce a project that can actually be OPENED, which is the one thing the previous
	 * stub did not do: it shaped a slug, persisted nothing, and returned success, so the modal
	 * navigated to a page that answered 404. On the stub path the draft is written into the per-process
	 * write store; on the live path it is inserted through the RLS-scoped client.
	 */
	static async create(
		input: CreateProject,
		actor: ReadActor,
	): Promise<ServiceResult<CreatedProject>> {
		// A create genuinely needs an identity: `owner_user_id` is the column RLS checks against, and
		// there is no coherent draft to mint without one. The reads answer a guest from the fixtures;
		// this cannot.
		const denied = requireIdentity<CreatedProject>(actor, "create a project");
		if (denied) return denied;

		const owner = writeOwnerOf(actor);

		if (isProjectsBackendLive() && canReadLive(actor)) {
			try {
				// No slug is threaded in: the live insert mints its own so it can RETRY on the unique index,
				// which is the only authority on whether an address is free at the instant of the write.
				const outcome = await insertProject(actor, input);
				if (outcome === null) return notFound<CreatedProject>("project", input.title);
				if ("refusal" in outcome) return refused<CreatedProject>(outcome.refusal);
				invalidateProjects(actor);
				return ok(outcome.data, { status: 201, message: "Project drafted." });
			} catch (error) {
				// A thrown live WRITE never falls back to the stub (see {@link liveWrite}): storing it in
				// memory and answering `ok` would report a project Postgres never accepted, and the client
				// would navigate to an id that exists nowhere.
				liveFailed("create", error);
				return fail<CreatedProject>(502, {
					message: "That project could not be created — please try again.",
				});
			}
		}

		const setup = buildCreatedSetup(input, mintProjectSlug((c) => stubSlugTaken(owner, c)));
		recordCreatedProject(owner, setup);
		invalidateProjects(actor);
		return ok({ id: setup.id, slug: setup.slug }, {
			status: 201,
			message: "Project drafted.",
		});
	}

	/**
	 * Instantiate a **Pipeline service template** into the acting client's workspace as a draft
	 * project — the write behind "Add to Projects".
	 *
	 * What the live path will do, and what the shapes here already promise:
	 * - insert `projects.projects` with `status = 'draft'`, `visibility = 'unlisted'` and
	 *   `source_blueprint_id` pointing at the service;
	 * - copy the blueprint's stages into `projects.project_stages`;
	 * - leave every `projects.stage_assignments` row at `pending_funding`, so nobody is committed to
	 *   anything and no escrow exists until the client funds the first ticket.
	 *
	 * **No money moves and nothing is reserved.** That is the whole reason this is a draft rather than
	 * a basket line: a pipeline is not bought, it is staffed and then bought against, one ticket at a
	 * time (`PRODUCT_SPEC.md` §Creation & Purchasing Gate). A buyer must be able to open the board and
	 * read the stages before deciding anything, which a basket line cannot hold.
	 *
	 * Idempotent on `input.idempotencyKey`: a repeat returns the SAME draft with `created: false`
	 * rather than refusing, so a double-press or a retry after an unseen timeout cannot leave two
	 * identical pipelines in someone's workspace.
	 */
	static instantiateService(
		input: InstantiateServiceInput,
		actor: { userId: string | null },
	): ServiceResult<{ draft: PipelineDraft; created: boolean }> {
		const item = findItem(input.serviceId);
		if (!item || item.type !== "services") {
			return fail(404, { message: `No service found for id "${input.serviceId}".` });
		}
		if (item.serviceType !== "Pipeline") {
			return fail(422, {
				message: "Only a pipeline service can be added to your projects.",
				errors: { serviceId: "not_a_pipeline" },
			});
		}

		const view = buildViewPage(item);
		const stageCount = view.service?.stages.length ?? 0;

		const result = instantiateDraft(input, {
			serviceId: item.id,
			title: item.title,
			stageCount,
			userId: actor.userId,
			workspaceId: input.workspaceId,
		});
		if (result.created) {
			const owner = draftWriteOwner(actor, input.workspaceId);
			recordCreatedProject(owner, buildInstantiatedSetup(item, view, result.draft));
			invalidateProjects({
				userId: actor.userId ?? "",
				contextId: input.workspaceId ?? actor.userId ?? "",
				contextType: input.workspaceId ? "team" : "personal",
			});
		}

		if (!isProjectsBackendLive()) {
			return ok(result, {
				status: result.created ? 201 : 200,
				message: result.created
					? "Added to your projects as a draft."
					: "This service is already in your projects.",
			});
		}
		// LIVE: insert the project + copy the blueprint stages through the RLS-scoped RPC (not yet
		// implemented) — fall through to the store so behaviour is preserved either side of the gate.
		return ok(result, {
			status: result.created ? 201 : 200,
			message: result.created
				? "Added to your projects as a draft."
				: "This service is already in your projects.",
		});
	}

	/**
	 * Soft-archive a draft pipeline — the "Remove / Archive draft" secondary control.
	 *
	 * Nothing is hard-deleted (root CLAUDE.md §7): the status becomes `archived`, the row and its audit
	 * trail stay, and the listing's primary control reverts to "Add to Projects" because
	 * {@link findDraft} deliberately does not return archived rows.
	 *
	 * It refuses a draft that has already been funded. That is not caution — an archived project whose
	 * stage holds escrowed money is a project whose money has nowhere to go, and the recovery path for
	 * one is a support ticket rather than a button.
	 */
	static archiveDraft(
		input: ArchiveDraftInput,
		actor: { userId: string | null },
	): ServiceResult<{ draft: PipelineDraft }> {
		const current = getDraft(input.projectId, actor.userId);
		if (!current) return fail(404, { message: "That draft is no longer in your projects." });
		if (current.fundedStageCount > 0) {
			return fail(409, {
				message: "This project has funded work in it and cannot be archived from here.",
				errors: { projectId: "has_funded_stages" },
			});
		}
		const draft = archiveDraft(input.projectId, actor.userId);
		if (!draft) return fail(404, { message: "That draft is no longer in your projects." });
		// The project the instantiation minted for the ordinary reads archives with its draft, so the
		// feed and the Add-to-project menu stop offering an engagement the listing no longer claims.
		const owner = draftWriteOwner(actor, null);
		const created = storedCreatedProject(owner, draft.slug);
		if (created) {
			recordProjectArchive(owner, { id: created.id, slug: created.slug }, new Date().toISOString());
		}
		return ok({ draft }, { message: "Draft archived." });
	}

	/**
	 * Archive every un-funded service draft idle for {@link DRAFT_IDLE_DAYS} days.
	 *
	 * The scheduled counterpart of {@link ProjectBackendService.archiveDraft}, and the TypeScript twin
	 * of `projects.fn_archive_stale_service_drafts`. Both call the SSOT's own `draftIsStale`, so the
	 * job and the app cannot drift into different definitions of stale.
	 *
	 * It exists on this side as well as in SQL because with `PROJECTS_BACKEND_LIVE` off there is no
	 * database to run the job — and a rule that only exists on the path nobody is exercising is a rule
	 * nobody has tested.
	 */
	static sweepStaleDrafts(now?: number): ServiceResult<{ archived: PipelineDraft[] }> {
		const archived = sweepStaleDrafts(now);
		return ok({ archived }, {
			message: archived.length === 0
				? "No stale drafts to archive."
				: `Archived ${archived.length} stale ${archived.length === 1 ? "draft" : "drafts"}.`,
		});
	}
}
