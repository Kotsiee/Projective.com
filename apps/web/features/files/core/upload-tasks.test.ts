import { assertEquals, assertNotEquals } from "@std/assert";
import { uploadTasksOf } from "./upload-tasks.ts";

Deno.test("each picked file becomes one queued task bound for the folder, with its own key", () => {
	const files = [
		new File(["abc"], "brief.pdf", { type: "application/pdf" }),
		new File(["x"], "notes"),
	];
	const tasks = uploadTasksOf(files, "fld-1");
	assertEquals(tasks.map((t) => [t.name, t.sizeBytes, t.folderId, t.phase]), [
		["brief.pdf", 3, "fld-1", "queued"],
		["notes", 1, "fld-1", "queued"],
	]);
	assertEquals(tasks[1].mimeType, "application/octet-stream");
	assertNotEquals(tasks[0].id, tasks[1].id);
	assertEquals(uploadTasksOf([], null), []);
});
