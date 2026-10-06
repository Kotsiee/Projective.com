import { assert, assertEquals } from "@std/assert";
import {
	type NextActionKind,
	type ProjectWorkspace,
	ProjectWorkspaceSchema,
	type WorkspaceViewer,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { allProjects } from "./fixtures.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";

/**
 * The Overview's composed read over the fixture corpus (Decision #144).
 *
 * Asserts REACHABILITY, not appearance — the #84 lesson: a branch no fixture can reach is dead code,
 * and every one of them type-checks. Each "Needs you" kind a viewer can be shown must be produced by
 * at least one corpus project, and every composed read must parse against its own schema.
 */

const ACTOR: ReadActor = { userId: "u-fixture", contextId: "", contextType: "personal" };

async function workspacesFor(viewer: WorkspaceViewer): Promise<ProjectWorkspace[]> {
	const out: ProjectWorkspace[] = [];
	for (const row of allProjects()) {
		const res = await ProjectBackendService.workspace(row.slug, ACTOR, viewer);
		if (res.ok && res.data) out.push(res.data.workspace);
	}
	return out;
}

function kindsOf(workspaces: readonly ProjectWorkspace[]): Set<NextActionKind> {
	return new Set(workspaces.flatMap((w) => w.nextActions.map((a) => a.kind)));
}

Deno.test("every composed Overview parses against its schema, for both viewers", async () => {
	for (const viewer of ["owner", "participant"] as const) {
		const workspaces = await workspacesFor(viewer);
		assert(workspaces.length > 0, `no ${viewer} Overview composed at all`);
		for (const w of workspaces) {
			const parsed = ProjectWorkspaceSchema.safeParse(w);
			assert(
				parsed.success,
				`${w.slug} (${viewer}): ${parsed.success ? "" : parsed.error.message}`,
			);
			assertEquals(w.viewer, viewer);
		}
	}
});

Deno.test("the corpus reaches every owner action the Overview can list", async () => {
	const seen = kindsOf(await workspacesFor("owner"));
	for (const kind of ["review_submissions", "decide_applications", "set_pricing"] as const) {
		assert(seen.has(kind), `no fixture produces the owner action "${kind}"`);
	}
});

Deno.test("the corpus reaches every participant action the Overview can list", async () => {
	const seen = kindsOf(await workspacesFor("participant"));
	for (const kind of ["deliver_work", "revise_work"] as const) {
		assert(seen.has(kind), `no fixture produces the participant action "${kind}"`);
	}
});

Deno.test("an owner is never handed a participant's action, nor the reverse", async () => {
	for (const w of await workspacesFor("owner")) {
		for (const a of w.nextActions) {
			assert(!["deliver_work", "revise_work"].includes(a.kind), `${w.slug}: owner got ${a.kind}`);
		}
	}
	for (const w of await workspacesFor("participant")) {
		for (const a of w.nextActions) {
			assert(
				!["review_submissions", "decide_applications", "set_pricing"].includes(a.kind),
				`${w.slug}: participant got ${a.kind}`,
			);
		}
	}
});

Deno.test("prices and unpriced flags are the owner's alone", async () => {
	for (const w of await workspacesFor("participant")) {
		for (const s of w.stages) {
			assertEquals(s.price, null, `${w.slug}: a participant was shown ${s.name}'s price`);
			assertEquals(s.needsPrice, false, `${w.slug}: a participant was shown ${s.name} as unpriced`);
		}
	}
});

Deno.test("a participant sees ticket counts only on the stages they are seated on", async () => {
	for (const w of await workspacesFor("participant")) {
		for (const s of w.stages) {
			if (!s.mine) assertEquals(s.tickets, null, `${w.slug}: counted tickets on ${s.name}`);
		}
	}
});

Deno.test("every stage run is in order and every action links into this engagement", async () => {
	for (const viewer of ["owner", "participant"] as const) {
		for (const w of await workspacesFor(viewer)) {
			w.stages.forEach((s, i) => assertEquals(s.ordinal, i + 1, `${w.slug}: ordinal`));
			for (const a of w.nextActions) {
				assert(a.href.startsWith(`/projects/${w.slug}/`), `${w.slug}: ${a.kind} → ${a.href}`);
			}
		}
	}
});
