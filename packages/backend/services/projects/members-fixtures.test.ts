import { assert, assertEquals } from "@std/assert";
import { OVERSIGHT_ROLES } from "@projective/types/projects";
import { findMemberRoster } from "./members-fixtures.ts";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * members-fixtures_test — the stub roster honours the stage roster rule (Decision #145): a stage page
 * lists the people assigned to that stage plus the oversight roles, and nobody else.
 */

const PROJECT = "prj-eangynf67d";

function stageSlugs(): string[] {
	const detail = findProjectDetail(PROJECT);
	if (!detail) throw new Error("fixture project missing");
	return detail.channels.stages.map((stage) => stage.slug);
}

Deno.test("a stage roster lists only its assignees and the oversight roles", () => {
	for (const slug of stageSlugs()) {
		const page = findMemberRoster({ projectId: PROJECT, channelId: slug });
		assert(page);
		assertEquals(page.channelKind, "stage");
		const stageName = page.stages.find((stage) => stage.id === page.stageId)?.name;
		assert(stageName, `stage ${slug} resolves to a roster stage`);
		for (const row of page.members) {
			const assigned = row.assignedStages.includes(stageName);
			assert(
				assigned || OVERSIGHT_ROLES.has(row.role),
				`${row.party.name} (${row.role}) is on ${stageName} without a relationship to it`,
			);
			assertEquals(row.assignment, assigned ? "contributor" : "observer");
		}
		assertEquals(page.total, page.members.length);
	}
});

Deno.test("an unassigned participant stays on the project roster", () => {
	const project = findMemberRoster({ projectId: PROJECT });
	assert(project);
	const [first] = stageSlugs();
	const stage = findMemberRoster({ projectId: PROJECT, channelId: first });
	assert(stage);
	const onStage = new Set(stage.members.map((row) => row.id));
	const absent = project.members.filter((row) => !onStage.has(row.id));
	assert(absent.length > 0, "the fixture has someone without a seat on the first stage");
	for (const row of absent) assertEquals(OVERSIGHT_ROLES.has(row.role), false);
	assert(project.total > stage.total);
});
