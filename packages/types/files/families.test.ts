import { assertEquals } from "@std/assert";
import { type FileFamily, fileFamily } from "./families.ts";

const BRIEF: Readonly<Record<Exclude<FileFamily, "link" | "other">, readonly string[]>> = {
	spreadsheet: ["xlsx", "xls", "csv"],
	document: ["docx", "doc", "txt", "rtf", "md"],
	presentation: ["pptx", "ppt", "key"],
	pdf: ["pdf"],
	image: ["png", "jpg", "jpeg", "webp", "svg", "hdr", "exr"],
	video: ["mp4", "webm", "mov"],
	audio: ["mp3", "wav", "ogg"],
	code: ["js", "ts", "py", "json", "html", "css", "yaml", "sql"],
	model: ["obj", "stl", "gltf", "glb"],
	archive: ["zip", "tar", "gz"],
};

Deno.test("every extension the palette names lands in its family", () => {
	for (const [family, extensions] of Object.entries(BRIEF)) {
		for (const ext of extensions) assertEquals(fileFamily({ ext }), family, ext);
	}
});

Deno.test("the extension outranks a taxonomy that files it elsewhere", () => {
	assertEquals(fileFamily({ ext: "csv", category: "Data", kind: "file" }), "spreadsheet");
	assertEquals(fileFamily({ ext: "pdf", category: "Document", kind: "doc" }), "pdf");
	assertEquals(fileFamily({ ext: "PNG" }), "image");
});

Deno.test("a link is a link whatever its address looks like", () => {
	assertEquals(fileFamily({ ext: "", source: "link" }), "link");
	assertEquals(fileFamily({ ext: "pdf", source: "link" }), "link");
	assertEquals(fileFamily({ ext: "", kind: "link" }), "link");
});

Deno.test("an unknown extension falls back to the category, the kind, then the neutral tile", () => {
	assertEquals(fileFamily({ ext: "zzz", category: "Ebook" }), "document");
	assertEquals(fileFamily({ ext: "zzz", kind: "audio" }), "audio");
	assertEquals(fileFamily({ ext: "zzz", category: "Font", kind: "file" }), "other");
	assertEquals(fileFamily({ ext: "" }), "other");
});
