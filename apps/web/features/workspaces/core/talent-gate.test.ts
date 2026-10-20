import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
	presetCapabilities,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceKind,
	WorkspaceRole,
} from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import {
	type ConsoleResolutionShape,
	type ConsoleRouteApi,
	importWithoutGlyphs,
	type RegistryApi,
} from "./registry-import.testing.ts";

/**
 * The Talent module's gate (Decision #230 (i), #241): a business member opens the bench only with `hire`
 * — the capability `org.get_business_bench` asks — and a member without it following a link to
 * `/businesses/:h/talent` is answered with ONE 303 to the console root; a team never has the module.
 * No seeded business member lacks `hire` (FLAG (h)), so the redirect is pinned here: the route's own
 * path — `routeConsole` resolving through the real `resolveWorkspaceConsole` (`workspace-ssr.ts`), as
 * `consoleOutcome` wires it — with only the detail READ stubbed to answer the member's capabilities.
 * The registry's glyphs import CSS, so these modules load through {@link importWithoutGlyphs}.
 */

/** The `workspace-ssr.ts` slice under test (its real types cannot be named — see the loader). */
interface SsrApi {
	resolveWorkspaceConsole(
		kind: WorkspaceKind,
		ref: string,
		requested: string,
		actor: ReadActor,
		url: URL,
	): Promise<ConsoleResolutionShape | null>;
}

const { consoleResponse, routeConsole } = await importWithoutGlyphs<ConsoleRouteApi>(
	"./console-route.ts",
);
const { mayViewModule, hubsForViewer } = await importWithoutGlyphs<RegistryApi>(
	"./module-registry.tsx",
);
const hubKeys = (caps: readonly WorkspaceCapability[]) =>
	hubsForViewer("business", caps).map((h) => h.hub.key);
const { resolveWorkspaceConsole } = await importWithoutGlyphs<SsrApi>("./workspace-ssr.ts");

// #region Fixtures
const OWNER = presetCapabilities("owner", "business");
const ADMIN = presetCapabilities("admin", "business");
const MEMBER = presetCapabilities("member", "business");
/** A plain member the owner granted `hire`. */
const HIRER: WorkspaceCapability[] = [...MEMBER, "hire"];

const ACTOR = { userId: "u-member", contextId: "" } as unknown as ReadActor;

/**
 * The detail read as a member holding `capabilities` sees it (`null` = not a member: the read's 403).
 * Only what the console correction reads is filled in.
 */
function detailAnswer(
	capabilities: readonly WorkspaceCapability[] | null,
): ServiceResult<WorkspaceDetail> {
	if (capabilities === null) return { ok: false, status: 403, message: "Not a member." };
	return {
		ok: true,
		status: 200,
		data: {
			handle: "heliafinance",
			viewerCapabilities: [...capabilities],
		} as unknown as WorkspaceDetail,
	};
}

/** The response `/businesses/heliafinance/talent?view=x` gets, or `null` when it renders. */
async function talentFor(
	capabilities: readonly WorkspaceCapability[] | null,
): Promise<{ status: number; location: string | null } | null> {
	const detail = stub(
		WorkspaceBackendService,
		"detail",
		() => Promise.resolve(detailAnswer(capabilities)),
	);
	try {
		const url = new URL("http://localhost/businesses/heliafinance/talent?view=x");
		const route = await routeConsole(
			"business",
			"heliafinance",
			"talent",
			url,
			(module) => resolveWorkspaceConsole("business", "heliafinance", module, ACTOR, url),
		);
		assertEquals(detail.calls.length, 1, "one detail read per request");
		if (route.kind === "render") return null;
		const res = consoleResponse(route);
		return { status: res.status, location: res.headers.get("location") };
	} finally {
		detail.restore();
	}
}
// #endregion

Deno.test("talent gate: hire opens the bench — owner, admin, and a member granted it", () => {
	assertEquals(mayViewModule("talent", "business", OWNER), true);
	assertEquals(mayViewModule("talent", "business", ADMIN), true);
	assertEquals(mayViewModule("talent", "business", HIRER), true);
});

Deno.test("talent gate: a plain business member without hire does not see it", () => {
	assertEquals(mayViewModule("talent", "business", MEMBER), false);
	assertEquals(hubKeys(MEMBER).includes("talent"), false);
});

Deno.test("talent gate: a team never has the module, whatever the role", () => {
	for (const role of WorkspaceRole.options) {
		const caps = presetCapabilities(role, "team");
		assertEquals(mayViewModule("talent", "team", caps), false, role);
	}
});

Deno.test("talent gate: Talent is a business's Core operations hub (Decision #306)", () => {
	const talent = hubsForViewer("business", ADMIN).find((h) => h.hub.key === "talent");
	assertEquals(talent?.hub.zone, "operations");
	assertEquals(hubKeys(ADMIN).includes("talent"), true);
});

Deno.test("talent gate: a holder of hire renders the page", async () => {
	assertEquals(await talentFor(HIRER), null);
	assertEquals(await talentFor(OWNER), null);
});

Deno.test("talent gate: a member without hire gets ONE 303 to the console root, ?view= dropped", async () => {
	assertEquals(await talentFor(MEMBER), { status: 303, location: "/businesses/heliafinance" });
});

Deno.test("talent gate: a non-member gets ONE 303 to the roster's unavailable notice", async () => {
	assertEquals(await talentFor(null), {
		status: 303,
		location: "/businesses?notice=unavailable",
	});
});
