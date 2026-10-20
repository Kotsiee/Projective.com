import { assertEquals } from "@std/assert";
import { entityDriveView } from "./files-module-model.ts";

Deno.test("an active team's drive offers Upload and lives at its console's files route", () => {
	const view = entityDriveView({ kind: "team", handle: "atelier-nova", name: "Atelier Nova", status: "active" });
	assertEquals(view.base, "/teams/atelier-nova/files");
	assertEquals(view.canUpload, true);
	assertEquals(view.readOnlyNote, null);
	assertEquals(view.emptyNote, "Files any member of the team uploads appear here for everyone in it.");
});

Deno.test("a draft business's drive still takes files — a draft is unpublished, not frozen", () => {
	const view = entityDriveView({ kind: "business", handle: "helia", name: "Helia", status: "draft" });
	assertEquals(view.base, "/businesses/helia/files");
	assertEquals(view.canUpload, true);
});

Deno.test("an archived entity's drive is readable and takes nothing new", () => {
	const view = entityDriveView({ kind: "team", handle: "old", name: "Old Crew", status: "archived" });
	assertEquals(view.canUpload, false);
	assertEquals(view.readOnlyNote, "Old Crew is archived. Its files stay readable; restore the team to add more.");
	assertEquals(view.emptyNote, "Old Crew's drive is empty.");
});
