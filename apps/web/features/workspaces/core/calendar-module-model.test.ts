import { assertEquals } from "@std/assert";
import type { TeamEngagement, WorkspaceProject } from "@projective/types/workspace";
import {
	entityCalendarProjectIds,
	entityCalendarView,
	entityEventTarget,
} from "./calendar-module-model.ts";

/** The Calendar module's pure decisions (Decision #308). */

function project(id: string): WorkspaceProject {
	return {
		id,
		title: id,
		href: `/projects/${id}`,
		counterparty: "Client",
		counterpartyAvatar: "",
		state: "active",
		statusLabel: "Active",
		progress: 0,
		due: null,
	};
}

function engagement(projectSlug: string): TeamEngagement {
	return {
		projectSlug,
		title: projectSlug,
		stageSlug: "stg-one",
		stageTitle: "One",
		assignmentStatus: "accepted",
		projectStatus: "active",
		assignees: [],
		stageWi: 0,
		stageCap: null,
	};
}

Deno.test("the calendar reads the detail's projects, then a team's engagement projects, each once", () => {
	assertEquals(
		entityCalendarProjectIds({
			projects: [project("prj-a"), project("prj-b")],
			engagements: [engagement("prj-b"), engagement("prj-c")],
		}),
		["prj-a", "prj-b", "prj-c"],
	);
});

Deno.test("a business's calendar reads its commissions", () => {
	assertEquals(entityCalendarProjectIds({ projects: [project("prj-z")], engagements: [] }), [
		"prj-z",
	]);
});

Deno.test("an entity with no projects reads none and says so", () => {
	assertEquals(entityCalendarProjectIds({ projects: [], engagements: [] }), []);
	const view = entityCalendarView({ kind: "team", name: "Atelier Nova", projectCount: 0 });
	assertEquals(view.emptyNote, "This team has no projects yet, so nothing is scheduled.");
});

Deno.test("the note counts the projects the union was read across, in the entity's own words", () => {
	assertEquals(
		entityCalendarView({ kind: "team", name: "Atelier Nova", projectCount: 1 }).note,
		"Meetings, stage due dates and ticket deadlines across the 1 project Atelier Nova is delivering. New entries are added on each project's own calendar.",
	);
	assertEquals(
		entityCalendarView({ kind: "business", name: "Helia", projectCount: 3 }).note,
		"Meetings, stage due dates and ticket deadlines across the 3 projects Helia has commissioned. New entries are added on each project's own calendar.",
	);
});

Deno.test("a write on an entity event is addressed to its own project", () => {
	assertEquals(entityEventTarget({ projectId: "prj-a" }), {
		scope: "project",
		projectId: "prj-a",
		channelId: null,
	});
	assertEquals(entityEventTarget({}), null);
});
