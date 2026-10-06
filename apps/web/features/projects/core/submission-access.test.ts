/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import type { DevSeamState, DevSubmissionState } from "@web/utils/dev-seam.ts";
import type { ProjectFormat, SubmissionStatus } from "@projective/types/projects";
import type { EffectiveViewer } from "./submission-access.ts";

/**
 * The Submissions workflow's viewer + action state machine, pinned.
 *
 * Who reviews and who submits is the line between a client releasing escrow and a freelancer
 * grading their own work; the action state machine decides which of those controls is drawn. RLS and
 * `review_submission` are the real gates, but a control the server will refuse is still a control
 * that renders and does nothing (UI gate 11), so the model has to agree with them.
 *
 * ## Why the module is imported through a data URL
 *
 * `submission-access.ts` reaches `@web/utils/dev-seam.ts`, which reaches `dev.ts`, whose module scope
 * reads Vite's `import.meta.env.DEV` — `undefined` under a plain `deno test`, so a static import
 * throws before a single test runs. The resolvers under test never touch the seam's runtime (every
 * one takes the seam snapshot as an argument), so the module is loaded from its OWN source with only
 * the dev-seam specifier swapped for an inert stub. The code exercised is the file on disk, byte for
 * byte, apart from that one specifier.
 */

// #region Seam-free import
const DEV_SEAM = "@web/utils/dev-seam.ts";
const SEAM_STUB = "export function readDevSeam() { return null; }\n" +
	"export function subscribeDevSeam() { return () => {}; }\n";

function dataUrl(source: string, type: "typescript" | "javascript"): string {
	return `data:application/${type},${encodeURIComponent(source)}`;
}

/** Load a module from its source with every (transitive) dev-seam import replaced by the stub. */
async function seamFreeUrl(file: URL): Promise<string> {
	let source = await Deno.readTextFile(file);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		let target: string;
		if (spec === DEV_SEAM) target = dataUrl(SEAM_STUB, "javascript");
		else if (spec.startsWith(".")) {
			const dep = new URL(spec, file);
			target = (await Deno.readTextFile(dep)).includes(DEV_SEAM)
				? await seamFreeUrl(dep)
				: dep.href;
		} else target = import.meta.resolve(spec);
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	return dataUrl(source, "typescript");
}

const SA: typeof import("./submission-access.ts") = await import(
	await seamFreeUrl(new URL("./submission-access.ts", import.meta.url))
);
const {
	effectiveFormat,
	effectiveHasTasks,
	effectiveUnitStatus,
	fulfilsTickets,
	mapDevSubmissionStatus,
	resolveViewer,
	resolveWorkflowActions,
} = SA;
// #endregion

// #region Fixtures
function seam(over: Partial<DevSeamState> = {}): DevSeamState {
	return {
		enabled: true,
		persona: "client",
		role: "admin",
		entity: "",
		isOwner: false,
		projectType: "pipeline",
		serviceType: "standard_project",
		sessionBookingStatus: "confirmed",
		multiSubGroup: false,
		stageAssignment: "assigned",
		submissionState: "draft",
		hasTasks: true,
		projectOnboarding: "auto",
		memberRole: "owner_admin",
		pendingInvites: false,
		pendingRequests: false,
		messagingRole: "client",
		micPermission: "auto",
		layoutDirection: "auto",
		profileSetup: "auto",
		...over,
	};
}

const PERSONAS = ["client", "freelancer", "team", "business"] as const;
const ROLES = ["admin", "manager", "worker", "guest"] as const;
const STATUSES: (SubmissionStatus | null)[] = [
	null,
	"draft",
	"pending_review",
	"revision_requested",
	"accepted",
];

const REVIEWER: EffectiveViewer = { isReviewer: true, isFreelancer: false, stageAssigned: true };
const FREELANCER: EffectiveViewer = { isReviewer: false, isFreelancer: true, stageAssigned: true };
// #endregion

// #region Effective viewer — the real session
Deno.test("without an override the client side reviews and the provider side submits", () => {
	assertEquals(resolveViewer(true, null), REVIEWER);
	assertEquals(resolveViewer(false, null), FREELANCER);
});
// #endregion

// #region Effective viewer — the simulated persona
Deno.test("an outright buyer reviews, whatever role the switcher carries", () => {
	for (const persona of ["client", "business"] as const) {
		for (const role of ROLES) {
			const v = resolveViewer(false, seam({ persona, role }));
			assert(v.isReviewer && !v.isFreelancer, `${persona}/${role}`);
		}
	}
});

Deno.test("a freelancer submits, even holding an admin role or the owner flag", () => {
	for (const role of ROLES) {
		for (const isOwner of [true, false]) {
			const v = resolveViewer(true, seam({ persona: "freelancer", role, isOwner }));
			assert(v.isFreelancer && !v.isReviewer, `${role}/${isOwner}`);
		}
	}
});

Deno.test("inside a team, admin and manager review; worker and guest submit", () => {
	const side = (role: (typeof ROLES)[number]) =>
		resolveViewer(true, seam({ persona: "team", role })).isReviewer;
	assertEquals(ROLES.map(side), [true, true, false, false]);
});

Deno.test("the simulated persona wins over the real session in both directions", () => {
	assert(resolveViewer(true, seam({ persona: "freelancer" })).isFreelancer);
	assert(resolveViewer(false, seam({ persona: "client" })).isReviewer);
});

Deno.test("every simulated seat is exactly one side of the market", () => {
	for (const persona of PERSONAS) {
		for (const role of ROLES) {
			const v = resolveViewer(true, seam({ persona, role }));
			assert(v.isReviewer !== v.isFreelancer, `${persona}/${role}`);
		}
	}
});

Deno.test("stage assignment follows the simulated flag", () => {
	const f = (stageAssignment: "assigned" | "unassigned") =>
		resolveViewer(false, seam({ persona: "freelancer", stageAssignment })).stageAssigned;
	assertEquals(f("assigned"), true);
	assertEquals(f("unassigned"), false);
});

Deno.test("fails OPEN (pinned, reported): an unrecognised persona or team role resolves to reviewer", () => {
	// `isFreelancer` is an allow-list and `isReviewer` its negation, so anything off the list lands on
	// the reviewing side. Dev-seam only (production seam is always null), but it is the wrong default.
	const stray = seam({ persona: "guest" as DevSeamState["persona"] });
	assertEquals(resolveViewer(false, stray).isReviewer, true);
	const strayRole = seam({ persona: "team", role: "viewer" as DevSeamState["role"] });
	assertEquals(resolveViewer(false, strayRole).isReviewer, true);
});
// #endregion

// #region Format + tasks
Deno.test("only a one-off fulfils no tickets", () => {
	const formats: ProjectFormat[] = ["one_off", "pipeline", "session"];
	assertEquals(formats.map(fulfilsTickets), [false, true, true]);
});

Deno.test("the simulated project type and task flag win; without an override the server's stand", () => {
	assertEquals(effectiveFormat("pipeline", null), "pipeline");
	assertEquals(effectiveFormat("pipeline", seam({ projectType: "one_off" })), "one_off");
	assertEquals(effectiveHasTasks(true, null), true);
	assertEquals(effectiveHasTasks(true, seam({ hasTasks: false })), false);
	assertEquals(effectiveHasTasks(false, seam({ hasTasks: true })), true);
});
// #endregion

// #region Status mapping
Deno.test("every simulated submission state maps onto a canonical status", () => {
	const map: Record<DevSubmissionState, SubmissionStatus> = {
		draft: "draft",
		submitted: "pending_review",
		approved: "accepted",
		revision_requested: "revision_requested",
	};
	for (const [dev, canonical] of Object.entries(map)) {
		assertEquals(mapDevSubmissionStatus(dev as DevSubmissionState), canonical);
	}
});

Deno.test("an unrecognised simulated state maps to draft, never to a verdict", () => {
	assertEquals(mapDevSubmissionStatus("paid" as DevSubmissionState), "draft");
});

Deno.test("only a simulated freelancer's unit status is overridden", () => {
	const s = seam({ persona: "freelancer", submissionState: "approved" });
	assertEquals(effectiveUnitStatus("draft", FREELANCER, s), "accepted");
	assertEquals(effectiveUnitStatus(null, FREELANCER, s), "accepted");
	// A reviewer always sees the unit's real status, override or not.
	assertEquals(effectiveUnitStatus("pending_review", REVIEWER, s), "pending_review");
	assertEquals(effectiveUnitStatus(null, REVIEWER, s), null);
	// No override → the real status, for either side.
	assertEquals(effectiveUnitStatus("revision_requested", FREELANCER, null), "revision_requested");
	assertEquals(effectiveUnitStatus(null, FREELANCER, null), null);
});
// #endregion

// #region Action state machine
type Group = "review" | "approveStage" | "create" | "draftEdit" | "statusBadge";

function active(viewer: EffectiveViewer, hasActiveUnit: boolean, s: SubmissionStatus | null) {
	const a = resolveWorkflowActions({ viewer, hasActiveUnit, effectiveStatus: s });
	const on: Group[] = [];
	if (a.review) on.push("review");
	if (a.approveStage) on.push("approveStage");
	if (a.create) on.push("create");
	if (a.draftEdit) on.push("draftEdit");
	if (a.statusBadge !== null) on.push("statusBadge");
	return { a, on };
}

Deno.test("a reviewer at the root, or with no status, is offered nothing", () => {
	for (const s of STATUSES) assertEquals(active(REVIEWER, false, s).on, [], `root/${s}`);
	assertEquals(active(REVIEWER, true, null).on, []);
});

Deno.test("a reviewer never reviews a bare draft", () => {
	assertEquals(active(REVIEWER, true, "draft").on, []);
});

Deno.test("a reviewer reviews a submitted unit, and approves the stage only once it is accepted", () => {
	assertEquals(active(REVIEWER, true, "pending_review").on, ["review"]);
	assertEquals(active(REVIEWER, true, "revision_requested").on, ["review"]);
	assertEquals(active(REVIEWER, true, "accepted").on, ["review", "approveStage"]);
});

Deno.test("a reviewer is never handed a freelancer control", () => {
	for (const unit of [true, false]) {
		for (const s of STATUSES) {
			const { a } = active(REVIEWER, unit, s);
			assert(!a.create && !a.draftEdit && a.statusBadge === null, `${unit}/${s}`);
		}
	}
});

Deno.test("a freelancer at the root creates, whatever the simulated status", () => {
	for (const s of STATUSES) assertEquals(active(FREELANCER, false, s).on, ["create"], `${s}`);
});

Deno.test("a freelancer inside an unsent draft edits it", () => {
	assertEquals(active(FREELANCER, true, null).on, ["draftEdit"]);
	assertEquals(active(FREELANCER, true, "draft").on, ["draftEdit"]);
});

Deno.test("a freelancer inside a sent unit sees only its status — terminal states included", () => {
	for (const s of ["pending_review", "revision_requested", "accepted"] as const) {
		const { a, on } = active(FREELANCER, true, s);
		assertEquals(on, ["statusBadge"], s);
		assertEquals(a.statusBadge, s);
	}
});

Deno.test("a freelancer can never review or release escrow", () => {
	for (const unit of [true, false]) {
		for (const s of STATUSES) {
			const { a } = active(FREELANCER, unit, s);
			assert(!a.review && !a.approveStage, `${unit}/${s}`);
		}
	}
});

Deno.test("a seat that is both sides is treated as the reviewer", () => {
	const both = { isReviewer: true, isFreelancer: true, stageAssigned: true };
	assertEquals(active(both, true, "accepted").on, ["review", "approveStage"]);
});

Deno.test("a seat that is neither side falls to the freelancer branch, never to review", () => {
	const neither = { isReviewer: false, isFreelancer: false, stageAssigned: false };
	assertEquals(active(neither, false, null).on, ["create"]);
	assertEquals(active(neither, true, "accepted").on, ["statusBadge"]);
});

Deno.test("the full flow, through the resolvers the surfaces chain together", () => {
	const flow: [DevSubmissionState, Group[]][] = [
		["draft", ["draftEdit"]],
		["submitted", ["statusBadge"]],
		["revision_requested", ["statusBadge"]],
		["approved", ["statusBadge"]],
	];
	for (const [state, expected] of flow) {
		const s = seam({ persona: "freelancer", submissionState: state });
		const viewer = resolveViewer(false, s);
		const status = effectiveUnitStatus(null, viewer, s);
		assertEquals(active(viewer, true, status).on, expected, state);
	}
});
// #endregion
