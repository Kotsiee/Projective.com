import { assertEquals } from "@std/assert";
import {
	fileInspectHref,
	InspectAssetSchema,
	inspectable,
	mediaProxyHref,
	resolveViewer,
} from "./inspect.ts";

Deno.test("mediaProxyHref encodes the id and carries tier, download and share", () => {
	assertEquals(mediaProxyHref("a b"), "/api/media/proxy/a%20b");
	assertEquals(
		mediaProxyHref("id", { tier: "lg", download: true, share: "s1" }),
		"/api/media/proxy/id?tier=lg&download=1&share=s1",
	);
	assertEquals(mediaProxyHref("id", { share: null }), "/api/media/proxy/id");
});

Deno.test("fileInspectHref carries only the share slug", () => {
	assertEquals(fileInspectHref("id"), "/inspect/id");
	assertEquals(fileInspectHref("id", { share: "a&b" }), "/inspect/id?share=a%26b");
});

Deno.test("inspectable admits only uploaded platform objects", () => {
	assertEquals(inspectable({ source: "supabase", status: "uploaded" }), true);
	assertEquals(inspectable({ source: "supabase", status: "scanning" }), false);
	assertEquals(inspectable({ source: "link", status: "uploaded" }), false);
});

Deno.test("resolveViewer picks the canvas by extension before MIME", () => {
	assertEquals(resolveViewer("photo.JPG").viewer, "image");
	assertEquals(resolveViewer("scan.heic", "image/heic"), {
		viewer: "image",
		language: null,
		modelFormat: null,
		delimiter: null,
		rendition: true,
	});
	assertEquals(resolveViewer("logo.svg", "").viewer, "svg");
	assertEquals(resolveViewer("clip.webm").viewer, "video");
	assertEquals(resolveViewer("voice.m4a").viewer, "audio");
	assertEquals(resolveViewer("brief.pdf", "application/octet-stream").viewer, "pdf");
	assertEquals(resolveViewer("README.md", "").language, "markdown");
	assertEquals(resolveViewer("main.ts", "video/mp2t"), {
		viewer: "code",
		language: "typescript",
		modelFormat: null,
		delimiter: null,
		rendition: false,
	});
	assertEquals(resolveViewer("data.tsv").delimiter, "\t");
	assertEquals(resolveViewer("chair.glb", "").modelFormat, "glb");
	assertEquals(resolveViewer("notes.docx").viewer, "docx");
	assertEquals(resolveViewer("Inter.woff2").viewer, "font");
	assertEquals(resolveViewer("server.log").viewer, "text");
});

Deno.test("resolveViewer handles bare names and dotfiles", () => {
	assertEquals(resolveViewer("Dockerfile").language, "dockerfile");
	assertEquals(resolveViewer("LICENSE").viewer, "text");
	assertEquals(resolveViewer(".gitignore").viewer, "code");
	assertEquals(resolveViewer("a/b/Makefile").language, "makefile");
});

Deno.test("resolveViewer falls back to MIME, then to unsupported", () => {
	assertEquals(resolveViewer("blob", "image/png").viewer, "image");
	assertEquals(resolveViewer("blob", "model/gltf-binary").modelFormat, "glb");
	assertEquals(resolveViewer("blob", "application/json").language, "json");
	assertEquals(resolveViewer("blob", "text/x-whatever").viewer, "text");
	assertEquals(resolveViewer("archive.zip", "application/zip").viewer, "unsupported");
	assertEquals(resolveViewer("blob", "application/octet-stream").viewer, "unsupported");
	assertEquals(resolveViewer("legacy.doc", "application/msword").viewer, "unsupported");
	assertEquals(resolveViewer("", null).viewer, "unsupported");
});

Deno.test("InspectAssetSchema accepts a fully resolved asset", () => {
	const parsed = InspectAssetSchema.safeParse({
		id: "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2",
		name: "halcyon-motion.png",
		ext: "png",
		mimeType: "image/png",
		category: "Image",
		categoryLabel: "Image",
		kind: "image",
		viewer: "image",
		language: null,
		modelFormat: null,
		delimiter: null,
		sizeBytes: 1024,
		sizeLabel: "1 KB",
		width: 64,
		height: 64,
		durationMs: null,
		durationLabel: null,
		pageCount: null,
		peaks: null,
		blurhash: null,
		createdAt: "2026-10-09T00:00:00Z",
		dateLabel: "9 Oct 2026",
		owner: { handle: "renkoda", name: "Ren Koda", avatarSrc: null },
		ownerType: "user",
		visibility: "public",
		access: "public",
		canManage: false,
		src: "/api/media/proxy/6d43f88f-84c7-4454-a2e1-c3bd6a2839e2",
		previewSrc: null,
		downloadHref: "/api/media/proxy/6d43f88f-84c7-4454-a2e1-c3bd6a2839e2?download=1",
		share: null,
		shareUrl: null,
		downloadCount: null,
		contentHash: null,
	});
	assertEquals(parsed.success, true);
});
