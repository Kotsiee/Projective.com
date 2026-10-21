import { assertEquals } from "@std/assert";
import {
	type FileChannelRoutes,
	fileChannelRoutes,
	roomOfRef,
	sameSelection,
	searchWithSelection,
	selectionHref,
	selectionOfSearch,
	selectionTitle,
} from "./file-tree-route.ts";

const ROUTES: FileChannelRoutes = { "room-general": "room-general", "room-stage": "stg-brand" };

const CHANNELS = {
	general: [
		{ id: "g1", chatId: "g1", name: "General", kind: "general", unread: false },
		{ id: "g2", chatId: "g2", name: "Spare", kind: "general", unread: false },
	],
	stages: [{ id: "s1", slug: "stg-a", stageId: "ps1", order: 0 }],
	teams: [{ channels: [{ id: "t1", chatId: "t1", name: "Team", kind: "team", unread: false }] }],
	dms: [{ chatId: "d1" }],
};

Deno.test("fileChannelRoutes routes the discussion by `discussion`, a stage by its slug, the rest by id", () => {
	const routes = fileChannelRoutes(
		{ format: "pipeline", structure: "standard", channels: CHANNELS } as never,
	);
	assertEquals(routes, { g1: "discussion", g2: "g2", s1: "stg-a", t1: "t1", d1: "d1" });
	assertEquals(roomOfRef(routes, "stg-a"), "s1");
	assertEquals(roomOfRef(routes, "discussion"), "g1");
	assertEquals(roomOfRef(routes, "unknown"), "unknown");
});

Deno.test("fileChannelRoutes gives a Task's root stage room the discussion address", () => {
	const routes = fileChannelRoutes(
		{ format: "one_off", structure: "single_task", channels: CHANNELS } as never,
	);
	assertEquals(routes.s1, "discussion");
	assertEquals(routes.g1, "g1");
});

Deno.test("selectionOfSearch reads all, the project node, and a channel by its route ref", () => {
	assertEquals(selectionOfSearch(""), { kind: "all" });
	assertEquals(selectionOfSearch("?in="), { kind: "all" });
	assertEquals(selectionOfSearch("?in=project"), { kind: "project" });
	assertEquals(selectionOfSearch("?in=stg-brand&tkv=t", ROUTES), {
		kind: "channel",
		id: "room-stage",
	});
});

Deno.test("searchWithSelection writes the route ref and keeps every other parameter", () => {
	assertEquals(
		searchWithSelection("?tkv=t1", { kind: "channel", id: "room-stage" }, ROUTES),
		"?tkv=t1&in=stg-brand",
	);
	assertEquals(searchWithSelection("?in=project&tkv=t1", { kind: "all" }), "?tkv=t1");
	assertEquals(searchWithSelection("?in=stg-brand", { kind: "all" }), "");
	assertEquals(searchWithSelection("", { kind: "project" }), "?in=project");
});

Deno.test("selectionHref addresses a node from a channel's own Files route", () => {
	assertEquals(selectionHref("prj-x", { kind: "all" }, ROUTES), "/projects/prj-x/files");
	assertEquals(
		selectionHref("prj-x", { kind: "project" }, ROUTES),
		"/projects/prj-x/files?in=project",
	);
	assertEquals(
		selectionHref("prj-x", { kind: "channel", id: "room-stage" }, ROUTES),
		"/projects/prj-x/stg-brand/files",
	);
	assertEquals(selectionHref("prj-x", { kind: "channel", id: "room-gone" }, ROUTES), null);
});

Deno.test("selectionTitle names the node in view", () => {
	const channels = [{ id: "room-stage", name: "Brand identity", kind: "stage" as const, count: 3 }];
	assertEquals(selectionTitle({ kind: "all" }, channels), "All files");
	assertEquals(selectionTitle({ kind: "project" }, channels), "Project files");
	assertEquals(selectionTitle({ kind: "channel", id: "room-stage" }, channels), "Brand identity");
	assertEquals(selectionTitle({ kind: "channel", id: "room-gone" }, channels), "Channel files");
});

Deno.test("sameSelection compares nodes, a channel by its room", () => {
	assertEquals(sameSelection({ kind: "all" }, { kind: "all" }), true);
	assertEquals(sameSelection({ kind: "channel", id: "a" }, { kind: "channel", id: "a" }), true);
	assertEquals(sameSelection({ kind: "channel", id: "a" }, { kind: "channel", id: "b" }), false);
	assertEquals(sameSelection({ kind: "all" }, { kind: "project" }), false);
});
