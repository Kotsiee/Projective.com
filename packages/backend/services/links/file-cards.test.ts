import { assertEquals } from "@std/assert";
import type { AssetItem, InspectAsset } from "@projective/types/files";
import { FileLinkPreviewSchema } from "@projective/types/links";
import { fileCardFromInspect, fileCardFromShare } from "./file-cards.ts";

const ID = "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2";

const INSPECT: InspectAsset = {
	id: ID,
	name: "brief.pdf",
	ext: "pdf",
	mimeType: "application/pdf",
	category: "Document",
	categoryLabel: "PDF",
	kind: "pdf",
	viewer: "pdf",
	language: null,
	modelFormat: null,
	delimiter: null,
	sizeBytes: 2_516_582,
	sizeLabel: "2.4 MB",
	width: null,
	height: null,
	durationMs: null,
	durationLabel: null,
	pageCount: 4,
	peaks: null,
	blurhash: null,
	createdAt: "2026-11-09T00:00:00Z",
	dateLabel: "9 Nov 2026",
	owner: null,
	ownerType: "user",
	visibility: "restricted",
	access: "member",
	canManage: false,
	src: `/api/media/proxy/${ID}`,
	previewSrc: null,
	downloadHref: `/api/media/proxy/${ID}?download=1`,
	share: null,
	shareUrl: null,
	downloadCount: null,
	contentHash: null,
};

Deno.test("an inspector link's card opens the inspector and draws a document's type tile", () => {
	const card = fileCardFromInspect(`https://projective.io/inspect/${ID}`, INSPECT);
	assertEquals(card.href, `/inspect/${ID}`);
	assertEquals(card.assetId, ID);
	assertEquals(card.typeLabel, "PDF");
	assertEquals(card.sizeLabel, "2.4 MB");
	assertEquals(card.thumbnail, null);
	assertEquals(FileLinkPreviewSchema.safeParse(card).success, true);
});

Deno.test("a picture's card asks the proxy for the small rendition, carrying the share slug", () => {
	const card = fileCardFromInspect("https://projective.io/x", {
		...INSPECT,
		viewer: "image",
		kind: "image",
		share: "s1",
	});
	assertEquals(card.thumbnail, `/api/media/proxy/${ID}?tier=sm&share=s1`);
	assertEquals(card.href, `/inspect/${ID}?share=s1`);
});

Deno.test("a share link's card opens the share page and keeps only a same-origin picture", () => {
	const asset = {
		id: ID,
		name: "moodboard.png",
		ext: "png",
		kind: "image",
		category: "Image",
		sizeLabel: "320 KB",
		thumbnailUrl: `/api/files/object/${ID}?tier=sm&share=slug1`,
	} as unknown as AssetItem;
	const card = fileCardFromShare("https://projective.io/share/slug1", "slug1", asset);
	assertEquals(card.href, "/share/slug1");
	assertEquals(card.assetId, null);
	assertEquals(card.thumbnail, `/api/files/object/${ID}?tier=sm&share=slug1`);
	assertEquals(
		fileCardFromShare("u", "slug1", { ...asset, thumbnailUrl: "https://cdn.example/x.png" })
			.thumbnail,
		null,
	);
});
