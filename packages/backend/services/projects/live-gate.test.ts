import { assert, assertEquals } from "@std/assert";
import type { ProjectFeedParams } from "@projective/types/projects";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import type { ReadActor } from "../read-actor.ts";
import type { ServiceResult } from "../ServiceResult.ts";

/**
 * live-gate_test — PRD-B1: with `PROJECTS_BACKEND_LIVE` on, a read answers from the database or
 * fails. It never answers with the fixture corpus.
 *
 * Three roads, one table:
 *  - **Off.** The gate is off: the fixture road answers. Each case's inputs are taken FROM that road
 *    (a real fixture slug, stage, channel and ticket), so on the other two roads a fixture answer
 *    would be an `ok` with data. A refusal with no data therefore proves the fixture road never ran.
 *  - **No token.** The gate is on and the caller has no access token (a guest, or a session whose
 *    token lapsed): `401`, before any request leaves the process.
 *  - **Unreachable.** The gate is on, the caller is signed in, and every request to Supabase fails
 *    the way a stopped database fails: `503`.
 *
 * `serverEnv()` reads `Deno.env` on every call, so setting it around each case is enough. The
 * database is a `globalThis.fetch` that rejects, so no case needs a network.
 */

// #region Harness
/** Run `fn` with `vars` applied, restoring the previous environment afterwards. */
async function withEnv<T>(
	vars: Record<string, string | undefined>,
	fn: () => Promise<T>,
): Promise<T> {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		return await fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

/** Run `fn` against a database that cannot be reached, counting the requests that tried. */
async function withDeadDatabase<T>(fn: () => Promise<T>): Promise<{ value: T; requests: number }> {
	const real = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = (() => {
		requests++;
		return Promise.reject(new TypeError("error sending request: connection refused"));
	}) as typeof fetch;
	try {
		return { value: await fn(), requests };
	} finally {
		globalThis.fetch = real;
	}
}

/** `liveFailed` warns on every unreachable read; keep the test output to the assertions. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
	const warn = console.warn;
	const error = console.error;
	console.warn = () => {};
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.warn = warn;
		console.error = error;
	}
}

/** One line naming what a read answered, for a failure message that lists every offender. */
function describe(res: ServiceResult<unknown>): string {
	return `${res.ok ? "ok" : "refused"} ${res.status}${res.data === undefined ? "" : " with data"}`;
}

const LIVE = {
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	DENO_ENV: "development",
	PROJECTS_BACKEND_LIVE: "true",
};

const OFF = { ...LIVE, PROJECTS_BACKEND_LIVE: "false" };

const USER_ID = "00000000-0000-4000-8000-0000000000b1";

/** Signed in, but with no token Postgres could check — an expired, not-yet-refreshed session. */
const TOKENLESS: ReadActor = { userId: USER_ID, contextId: USER_ID, contextType: "personal" };

/** Nobody signed in. */
const GUEST: ReadActor = { userId: "", contextId: "", contextType: "personal" };

/** Signed in with a token, so every gated read reaches the (dead) database. A fresh id per call
 * keeps each case out of another's read-cache partition. */
function signedIn(): ReadActor {
	const id = crypto.randomUUID();
	return { userId: id, contextId: id, contextType: "personal", accessToken: "header.payload.sig" };
}

const FEED: ProjectFeedParams = {
	q: "",
	view: "projects",
	involvement: "all",
	sort: "recent",
	dir: "desc",
	scope: "global",
	scopeType: null,
	scopeId: "",
	workspaces: [],
	roles: [],
	formats: [],
	kinds: [],
	statuses: [],
	quick: [],
	requests: [],
	serviceId: "",
};
// #endregion

// #region The read surface
/** The fixture addresses every case reads, resolved on the off road. */
interface Corpus {
	slug: string;
	stageId: string;
	channelId: string;
	ticketSlug: string;
	handle: string;
}

/** One public read method, called with fixture addresses. */
type ReadCase = (corpus: Corpus, actor: ReadActor) => Promise<ServiceResult<unknown>>;

/**
 * Every PUBLIC read of the service. The test below fails when a public static is neither here nor in
 * {@link WRITES}, so a new read cannot ship without a row in this table.
 */
const READS: Record<string, ReadCase> = {
	list: (_, a) => ProjectBackendService.list(FEED, a),
	item: (c, a) => ProjectBackendService.item(c.slug, a),
	detail: (c, a) => ProjectBackendService.detail(c.slug, a),
	messages: (c, a) =>
		ProjectBackendService.messages({ projectId: c.slug, channelId: c.channelId }, a),
	files: (c, a) => ProjectBackendService.files({ projectId: c.slug }, a),
	submissions: (c, a) => ProjectBackendService.submissions({ projectId: c.slug }, a),
	board: (c, a) => ProjectBackendService.board({ projectId: c.slug }, a),
	ticket: (c, a) => ProjectBackendService.ticket(c.ticketSlug, a),
	timeline: (c, a) => ProjectBackendService.timeline({ projectId: c.slug }, a),
	members: (c, a) => ProjectBackendService.members({ projectId: c.slug }, a),
	sentInvites: (_, a) => ProjectBackendService.sentInvites(a),
	hireBrief: (c, a) => ProjectBackendService.hireBrief(c.slug, a),
	hireCooldowns: (c, a) => ProjectBackendService.hireCooldowns(c.handle, a),
	listInvites: (c, a) => ProjectBackendService.listInvites(c.slug, a),
	sentApplications: (_, a) => ProjectBackendService.sentApplications({}, a),
	setup: (c, a) => ProjectBackendService.setup(c.slug, a),
	overview: (c, a) => ProjectBackendService.overview(c.slug, a),
	workspace: (c, a) => ProjectBackendService.workspace(c.slug, a, "owner"),
	previewStageFairExit: (c, a) =>
		ProjectBackendService.previewStageFairExit({ projectId: c.slug, stageId: c.stageId }, a),
	previewProjectCancel: (c, a) =>
		ProjectBackendService.previewProjectCancel({ projectId: c.slug }, a),
};

/** Every public write of the service — covered by `liveWrite` and its siblings, not by this table. */
const WRITES = new Set([
	"inviteAction",
	"decideInvite",
	"removeMember",
	"hire",
	"inviteMemberToStages",
	"createStage",
	"deleteStage",
	"inviteMember",
	"updateMemberRole",
	"updateTicketManager",
	"apply",
	"withdrawApplication",
	"respondToInvitations",
	"acceptApplication",
	"rejectApplication",
	"updateProject",
	"archiveProject",
	"commitTicket",
	"moveTicket",
	"claimTicket",
	"deleteTicket",
	"sendMessage",
	"createSubmission",
	"reviewSubmission",
	"requestPaidRevision",
	"approveStage",
	"cancelStageFairExit",
	"cancelProject",
	"create",
	"instantiateService",
	"archiveDraft",
	"sweepStaleDrafts",
]);

/**
 * The reads with no fixture road at all: they refuse with the gate off as well (the stub store holds
 * no escrow), so the off road proves nothing about them and is not asked.
 */
const LIVE_ONLY = new Set(["previewStageFairExit", "previewProjectCancel"]);

/**
 * The one read that degrades to a NEUTRAL answer when the database cannot be reached, by design
 * (`fetchDeclinedInvitations`): a missing cooldown costs a client a day, a thrown read would take a
 * seller's whole profile down, and the write re-checks the cooldown in the database. Its answer is
 * the empty record, never the fixture roster's declines.
 */
const NEUTRAL_WHEN_UNREACHABLE = new Set(["hireCooldowns"]);

/** The private statics the class uses as helpers, not part of its public surface. */
const PRIVATE = new Set(["stubRoster", "stubInvite", "createdBoardStage", "inviteOnCreate"]);
// #endregion

// #region Corpus
/** Resolve the fixture addresses on the off road, where the fixture corpus answers. */
function resolveCorpus(): Promise<Corpus> {
	return withEnv(OFF, async () => {
		const feed = await ProjectBackendService.list(FEED, TOKENLESS);
		assert(feed.ok && feed.data, "the off road serves the fixture feed");
		for (const row of feed.data.items) {
			const board = await ProjectBackendService.board({ projectId: row.slug }, TOKENLESS);
			const detail = await ProjectBackendService.detail(row.slug, TOKENLESS);
			const card = board.data?.page.cards.find((c) => c.slug);
			const stage = board.data?.page.stages[0];
			const channel = detail.data?.detail.channels.stages[0];
			if (!card?.slug || !stage || !channel) continue;
			return {
				slug: row.slug,
				stageId: stage.id,
				channelId: channel.id,
				ticketSlug: card.slug,
				handle: "omar",
			};
		}
		throw new Error("no fixture project carries a board, a stage and a channel");
	});
}
// #endregion

Deno.test("the read table names every public method of the service", () => {
	const statics = Object.getOwnPropertyNames(ProjectBackendService).filter((name) =>
		typeof (ProjectBackendService as unknown as Record<string, unknown>)[name] === "function" &&
		!PRIVATE.has(name)
	);
	const unclassified = statics.filter((name) => !(name in READS) && !WRITES.has(name));
	assertEquals(unclassified, [], "classify each new public method as a read or a write");
	for (const name of Object.keys(READS)) {
		assert(statics.includes(name), `${name} is a public method`);
	}
});

Deno.test("gate off: the fixture road answers every read that has one", async () => {
	const corpus = await resolveCorpus();
	await withEnv(OFF, async () => {
		for (const [name, read] of Object.entries(READS)) {
			if (LIVE_ONLY.has(name)) continue;
			const res = await read(corpus, TOKENLESS);
			assert(res.ok, `${name} answers on the fixture road (${res.status} ${res.message ?? ""})`);
		}
	});
});

Deno.test("gate on: a caller with no token gets 401 and no data, before any request", async () => {
	const corpus = await resolveCorpus();
	await withEnv(LIVE, async () => {
		for (const actor of [TOKENLESS, GUEST]) {
			const { value: results, requests } = await withDeadDatabase(async () => {
				const out: [string, ServiceResult<unknown>][] = [];
				for (const [name, read] of Object.entries(READS)) {
					out.push([name, await read(corpus, actor)]);
				}
				return out;
			});
			const who = actor === GUEST ? "guest" : "tokenless";
			const wrong: string[] = [];
			for (const [name, res] of results) {
				if (actor === GUEST && name === "hireCooldowns") {
					// A guest has sent nobody an invitation: the truthful answer is empty, not a refusal.
					if (!res.ok || JSON.stringify(res.data) !== "{}") wrong.push(`${name}: ${describe(res)}`);
					continue;
				}
				if (res.ok || res.status !== 401 || res.data !== undefined) {
					wrong.push(`${name}: ${describe(res)}`);
				}
			}
			assertEquals(wrong, [], `every read refuses a ${who} caller with 401 and no data`);
			assertEquals(requests, 0, "a caller without a token never reaches the database");
		}
	});
});

/**
 * Every write, with the gate on and a signed-in caller whose token lapsed. The inputs are the
 * minimum each method touches before its gate; the routes' Zod parse is not under test here.
 *
 * Two writes are left out on purpose: `instantiateService` resolves the PUBLIC listing before it
 * asks for a session (the catalogue is the anon client's to read), and `sweepStaleDrafts` is the
 * stub twin of a SQL job, with no actor and no production caller.
 */
const WRITE_CASES: Record<string, (c: Corpus, a: ReadActor) => Promise<ServiceResult<unknown>>> = {
	inviteAction: (c, a) =>
		ProjectBackendService.inviteAction(
			{ projectId: c.slug, inviteId: "inv-1", action: "cancel" },
			a,
		),
	decideInvite: (c, a) =>
		ProjectBackendService.decideInvite(
			{ projectId: c.slug, inviteId: "inv-1", decision: "accept" },
			a,
		),
	removeMember: (c, a) =>
		ProjectBackendService.removeMember({ projectId: c.slug, memberId: "m-1", stageId: null }, a),
	hire: (c, a) => ProjectBackendService.hire({ projectId: c.slug, handle: "omar" } as never, a),
	inviteMemberToStages: (c, a) =>
		ProjectBackendService.inviteMemberToStages(
			{ projectId: c.slug, handle: "omar", stageIds: [c.stageId] } as never,
			a,
		),
	createStage: (c, a) =>
		ProjectBackendService.createStage(c.slug, { name: "Stage", unitPriceCents: 100 } as never, a),
	deleteStage: (c, a) =>
		ProjectBackendService.deleteStage({ projectId: c.slug, stageId: "stg-2222222222" }, a),
	inviteMember: (c, a) =>
		ProjectBackendService.inviteMember(c.slug, { recipients: [], stageId: null } as never, a),
	updateMemberRole: (c, a) => ProjectBackendService.updateMemberRole(c.slug, "m-1", "manager", a),
	updateTicketManager: (c, a) => ProjectBackendService.updateTicketManager(c.slug, "m-1", true, a),
	apply: (c, a) =>
		ProjectBackendService.apply(
			{ projectId: c.slug, stageId: c.stageId, roleId: null, teamId: null, message: "Hi" } as never,
			a,
		),
	withdrawApplication: (_, a) =>
		ProjectBackendService.withdrawApplication({ applicationId: "app-1" }, a),
	respondToInvitations: (_, a) =>
		ProjectBackendService.respondToInvitations({ invitationIds: ["inv-1"], accept: true }, a),
	acceptApplication: (_, a) =>
		ProjectBackendService.acceptApplication({ applicationId: "app-1" }, a),
	rejectApplication: (_, a) =>
		ProjectBackendService.rejectApplication({ applicationId: "app-1" } as never, a),
	updateProject: (c, a) => ProjectBackendService.updateProject(c.slug, { title: "Renamed" }, a),
	archiveProject: (c, a) => ProjectBackendService.archiveProject(c.slug, {} as never, a),
	commitTicket: (c, a) =>
		ProjectBackendService.commitTicket(
			{ projectId: c.slug, clientId: "t-1", title: "T", description: "", stages: [] } as never,
			a,
		),
	moveTicket: (c, a) =>
		ProjectBackendService.moveTicket(
			{ projectId: c.slug, ticketId: "t-1", status: "backlog", stageId: null } as never,
			a,
		),
	claimTicket: (c, a) =>
		ProjectBackendService.claimTicket({ projectId: c.slug, ticketId: "t-1" }, a),
	deleteTicket: (c, a) =>
		ProjectBackendService.deleteTicket({ projectId: c.slug, ticketId: "t-1" }, a),
	sendMessage: (c, a) =>
		ProjectBackendService.sendMessage(
			{ projectId: c.slug, channelId: c.channelId, text: "Hi", replyToId: null } as never,
			a,
		),
	createSubmission: (c, a) =>
		ProjectBackendService.createSubmission(
			{ projectId: c.slug, stageId: c.stageId, channelId: c.channelId, submit: false } as never,
			a,
		),
	reviewSubmission: (c, a) =>
		ProjectBackendService.reviewSubmission(
			{ projectId: c.slug, stageId: c.stageId, submissionId: "s-1", decision: "accept" } as never,
			a,
		),
	requestPaidRevision: (c, a) =>
		ProjectBackendService.requestPaidRevision(
			{ projectId: c.slug, submissionId: "s-1" } as never,
			a,
		),
	approveStage: (c, a) =>
		ProjectBackendService.approveStage({ projectId: c.slug, stageId: c.stageId } as never, a),
	cancelStageFairExit: (c, a) =>
		ProjectBackendService.cancelStageFairExit(
			{ projectId: c.slug, stageId: c.stageId, tier: 50 } as never,
			a,
		),
	cancelProject: (c, a) => ProjectBackendService.cancelProject({ projectId: c.slug } as never, a),
	create: (_, a) => ProjectBackendService.create({ title: "Draft", currency: "USD" } as never, a),
	archiveDraft: (c, a) => ProjectBackendService.archiveDraft({ projectId: c.slug }, a),
};

Deno.test("the write table names every write but the two documented exceptions", () => {
	const covered = new Set([...Object.keys(WRITE_CASES), "instantiateService", "sweepStaleDrafts"]);
	assertEquals([...WRITES].filter((name) => !covered.has(name)), []);
});

Deno.test("gate on: a tokenless writer gets 401 before any request, never the stub store", async () => {
	const corpus = await resolveCorpus();
	await withEnv(LIVE, async () => {
		const { value: results, requests } = await withDeadDatabase(async () => {
			const out: [string, ServiceResult<unknown>][] = [];
			for (const [name, write] of Object.entries(WRITE_CASES)) {
				out.push([name, await write(corpus, TOKENLESS)]);
			}
			return out;
		});
		const wrong = results
			.filter(([, res]) => res.ok || res.status !== 401 || res.data !== undefined)
			.map(([name, res]) => `${name}: ${describe(res)}`);
		assertEquals(wrong, [], "every write refuses a tokenless caller with 401");
		assertEquals(requests, 0, "a caller without a token never reaches the database");
	});
});

Deno.test("gate on: an unreachable database is a 503 with no data, never the fixtures", async () => {
	const corpus = await resolveCorpus();
	await withEnv(LIVE, async () => {
		const wrong: string[] = [];
		for (const [name, read] of Object.entries(READS)) {
			const { value: res, requests } = await quietly(() =>
				withDeadDatabase(() => read(corpus, signedIn()))
			);
			if (requests === 0) wrong.push(`${name}: never reached for the database`);
			if (NEUTRAL_WHEN_UNREACHABLE.has(name)) {
				if (!res.ok || JSON.stringify(res.data) !== "{}") wrong.push(`${name}: ${describe(res)}`);
				continue;
			}
			if (res.ok || res.status !== 503 || res.data !== undefined) {
				wrong.push(`${name}: ${describe(res)}`);
			}
		}
		assertEquals(wrong, [], "every read answers an unreachable database with 503 and no data");
	});
});
