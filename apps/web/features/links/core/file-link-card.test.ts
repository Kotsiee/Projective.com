import { assertEquals } from "@std/assert";
import { fileCardMeta, fileCardUrl } from "./file-link-card.ts";

Deno.test("fileCardMeta: the type in words, then the size", () => {
	assertEquals(
		fileCardMeta({ ext: "pdf", typeLabel: "PDF", sizeBytes: 2_516_582 }),
		"PDF · 2.4 MB",
	);
	assertEquals(
		fileCardMeta({ ext: "docx", typeLabel: "Document", sizeLabel: "18 KB" }),
		"Document · 18 KB",
	);
});

Deno.test("fileCardMeta: the extension stands in for an unknown type, and an unknown size is left out", () => {
	assertEquals(fileCardMeta({ ext: "fig", sizeBytes: null }), "FIG");
	assertEquals(fileCardMeta({ ext: "", typeLabel: null, sizeBytes: 0 }), "");
});

Deno.test("fileCardUrl: host and path, no scheme and no trailing slash", () => {
	assertEquals(fileCardUrl("/inspect/abc", "projective.io"), "projective.io/inspect/abc");
	assertEquals(
		fileCardUrl("/inspect/abc?share=s1", "localhost:5373"),
		"localhost:5373/inspect/abc?share=s1",
	);
	assertEquals(
		fileCardUrl("https://projective.io/share/slug/", "projective.io"),
		"projective.io/share/slug",
	);
});

Deno.test("fileCardUrl: before the page knows its host, the path alone", () => {
	assertEquals(fileCardUrl("/inspect/abc", ""), "inspect/abc");
});
