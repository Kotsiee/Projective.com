import { assertEquals } from "@std/assert";
import { defaultShareMode, shareMessage } from "./share-mode.ts";

const URL = "https://projective.io/inspect/6d43f88f-84c7-4454-a2e1-c3bd6a2839e2";
const FILE = { id: "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2", canLink: true };

Deno.test("a file starts as a link when the sender may share one, else as a copy", () => {
	assertEquals(defaultShareMode(FILE), "link");
	assertEquals(defaultShareMode({ ...FILE, canLink: false }), "copy");
});

Deno.test("a link share carries the file as a link and the note alone, without the URL", () => {
	assertEquals(
		shareMessage({ title: "brief.pdf", url: URL, file: FILE }, " Have a look ", "link"),
		{
			message: "Have a look",
			linkedFileIds: [FILE.id],
		},
	);
});

Deno.test("a copy carries the file as an attachment", () => {
	assertEquals(shareMessage({ title: "brief.pdf", url: URL, file: FILE }, "", "copy"), {
		message: "",
		attachmentIds: [FILE.id],
	});
});

Deno.test("a file the sender may not link goes as a copy even when a link was asked for", () => {
	assertEquals(
		shareMessage({ title: "brief.pdf", url: URL, file: { ...FILE, canLink: false } }, "", "link"),
		{ message: "", attachmentIds: [FILE.id] },
	);
});

Deno.test("anything that is not a file is sent as its URL", () => {
	assertEquals(
		shareMessage({ title: "Brand sprint", url: "https://projective.io/view/x" }, "", "link"),
		{
			message: "Brand sprint\nhttps://projective.io/view/x",
		},
	);
});
