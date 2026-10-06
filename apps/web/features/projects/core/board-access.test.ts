/// <reference lib="dom" />
import { assert, assertEquals } from "@std/assert";
import type { DevSeamState } from "@web/utils/dev-seam.ts";
import type { BoardAccess } from "./board-access.ts";
import type { SessionKind } from "./session-model.ts";

/**
 * The board's capability set, pinned. `isClient` is the board's primary gate (compose, create
 * stages, move cards on the pipeline, check out); `canEditTicket` is the narrower right to reword a
 * ticket a freelancer already agreed to deliver. RLS and `move_ticket` are the real gates — these
 * pin that the board draws the same answer the server will give, for every seat the Context
 * Switcher can stand in.
 *
 * ## Why the module is imported through a data URL
 *
 * `board-access.ts` reaches `@web/utils/dev-seam.ts` (directly, and through `submission-access.ts`
 * and `session-model.ts`), whose `dev.ts` reads Vite's `import.meta.env.DEV` at module scope —
 * `undefined` under a plain `deno test`, so a static import throws before any test runs. The resolver
 * takes the seam snapshot as an argument and never touches the seam's runtime, so each module is
 * loaded from its own source with only the dev-seam specifier swapped for an inert stub.
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

const { resolveBoardAccess }: typeof import("./board-access.ts") = await import(
	await seamFreeUrl(new URL("./board-access.ts", import.meta.url))
);
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

const ROLES = ["admin", "manager", "worker", "guest"] as const;
const KINDS: SessionKind[] = ["none", "normal", "group"];

const access = (
	viewerIsClient: boolean,
	s: DevSeamState | null,
	sessionKind: SessionKind = "none",
) => resolveBoardAccess({ viewerIsClient, sessionKind }, s);

/** The seat-shaped part of the answer (everything but the engagement-shaped `hasTickets`). */
const seat = (a: BoardAccess) => ({
	isClient: a.isClient,
	isFreelancer: a.isFreelancer,
	canEditTicket: a.canEditTicket,
});
// #endregion

// #region The real session
Deno.test("without an override the client side owns the board outright", () => {
	assertEquals(access(true, null), {
		isClient: true,
		isFreelancer: false,
		canEditTicket: true,
		hasTickets: true,
		stageAssigned: true,
		simulated: false,
	});
});

Deno.test("without an override the provider side composes and edits nothing", () => {
	assertEquals(access(false, null), {
		isClient: false,
		isFreelancer: true,
		canEditTicket: false,
		// The server's `viewerStageIds` decide which stages; the flag never narrows them here.
		hasTickets: true,
		stageAssigned: true,
		simulated: false,
	});
});

Deno.test("a session is booked, not ticketed — for either side", () => {
	for (const client of [true, false]) {
		assertEquals(KINDS.map((k) => access(client, null, k).hasTickets), [true, false, false]);
	}
});
// #endregion

// #region The simulated seat
Deno.test("an individual client or a business owns the engagement outright, in any role", () => {
	for (const persona of ["client", "business"] as const) {
		for (const role of ROLES) {
			assertEquals(seat(access(false, seam({ persona, role, isOwner: false }))), {
				isClient: true,
				isFreelancer: false,
				canEditTicket: true,
			}, `${persona}/${role}`);
		}
	}
});

Deno.test("inside a team, an admin edits tickets; a manager commissions but cannot reword", () => {
	assertEquals(seat(access(false, seam({ persona: "team", role: "admin" }))), {
		isClient: true,
		isFreelancer: false,
		canEditTicket: true,
	});
	assertEquals(seat(access(false, seam({ persona: "team", role: "manager", isOwner: false }))), {
		isClient: true,
		isFreelancer: false,
		canEditTicket: false,
	});
});

Deno.test("owning the entity earns a team manager the edit right", () => {
	assert(access(false, seam({ persona: "team", role: "manager", isOwner: true })).canEditTicket);
});

Deno.test("a team worker or guest is a provider seat, owner flag or not", () => {
	for (const role of ["worker", "guest"] as const) {
		for (const isOwner of [true, false]) {
			assertEquals(seat(access(true, seam({ persona: "team", role, isOwner }))), {
				isClient: false,
				isFreelancer: true,
				canEditTicket: false,
			}, `${role}/${isOwner}`);
		}
	}
});

Deno.test("a freelancer never composes or edits, whatever role or ownership is simulated", () => {
	for (const role of ROLES) {
		for (const isOwner of [true, false]) {
			assertEquals(seat(access(true, seam({ persona: "freelancer", role, isOwner }))), {
				isClient: false,
				isFreelancer: true,
				canEditTicket: false,
			}, `${role}/${isOwner}`);
		}
	}
});

Deno.test("the edit right never exceeds the client gate", () => {
	for (const persona of ["client", "freelancer", "team", "business"] as const) {
		for (const role of ROLES) {
			for (const isOwner of [true, false]) {
				const a = access(true, seam({ persona, role, isOwner }));
				assert(!a.canEditTicket || a.isClient, `${persona}/${role}/${isOwner}`);
				assert(a.isClient !== a.isFreelancer, `${persona}/${role}/${isOwner}`);
			}
		}
	}
});

Deno.test("an unassigned simulated freelancer is not onboarded to the stages in view", () => {
	const a = access(false, seam({ persona: "freelancer", stageAssignment: "unassigned" }));
	assertEquals(a.stageAssigned, false);
	assertEquals(a.simulated, true);
});

Deno.test("the simulated service type replaces the server's session kind", () => {
	const t = (serviceType: DevSeamState["serviceType"], baseline: SessionKind) =>
		access(true, seam({ serviceType }), baseline).hasTickets;
	assertEquals(t("standard_project", "normal"), true);
	assertEquals(t("normal_session", "none"), false);
	assertEquals(t("group_session", "none"), false);
});

Deno.test("fails OPEN (pinned, reported): an unrecognised persona is seated as the client", () => {
	// `resolveViewer` treats every persona off its freelancer allow-list as a reviewer, so a stray
	// persona composes; with an admin role (or the owner flag) it can also reword tickets.
	const stray = "guest" as DevSeamState["persona"];
	const worker = access(false, seam({ persona: stray, role: "worker", isOwner: false }));
	assertEquals(seat(worker), { isClient: true, isFreelancer: false, canEditTicket: false });
	const admin = access(false, seam({ persona: stray, role: "admin" }));
	assertEquals(seat(admin), { isClient: true, isFreelancer: false, canEditTicket: true });
});
// #endregion
