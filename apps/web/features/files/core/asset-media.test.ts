import { assertEquals } from "@std/assert";
import { AssetMetadataSchema } from "@projective/types/files";
import {
	type AssetMediaRef,
	assetMediaSrc,
	assetMediaSrcset,
	assetPlaceholder,
} from "./asset-media.ts";

// #region Fixtures
const ASSET_ID = "8b0c5a3e-1f2d-4c6b-9a7e-2d3f4a5b6c7d";
const LINK_ID = "11111111-2222-4333-8444-555555555555";

function ref(overrides: Partial<AssetMediaRef> = {}): AssetMediaRef {
	return {
		id: ASSET_ID,
		source: "supabase",
		status: "uploaded",
		url: `/api/files/object/${ASSET_ID}`,
		thumbnailUrl: `/api/files/object/${ASSET_ID}?tier=sm`,
		kind: "image",
		...overrides,
	};
}
// #endregion

// #region assetMediaSrc
Deno.test("assetMediaSrc reads a stored image's tier through the proxy", () => {
	assertEquals(assetMediaSrc(ref(), "sm"), `/api/media/proxy/${ASSET_ID}?tier=sm`);
	assertEquals(assetMediaSrc(ref(), "md"), `/api/media/proxy/${ASSET_ID}?tier=md`);
});

Deno.test("assetMediaSrc defaults to the original through the proxy", () => {
	assertEquals(assetMediaSrc(ref()), `/api/media/proxy/${ASSET_ID}`);
	assertEquals(assetMediaSrc(ref(), "original"), `/api/media/proxy/${ASSET_ID}`);
});

Deno.test("assetMediaSrc prefers assetId over the row id", () => {
	const row = ref({ id: LINK_ID, assetId: ASSET_ID });
	assertEquals(assetMediaSrc(row, "sm"), `/api/media/proxy/${ASSET_ID}?tier=sm`);
	assertEquals(assetMediaSrc(ref({ assetId: null }), "sm"), `/api/media/proxy/${ASSET_ID}?tier=sm`);
});

Deno.test("assetMediaSrc carries an explicit share slug", () => {
	assertEquals(assetMediaSrc(ref(), "sm", "abc"), `/api/media/proxy/${ASSET_ID}?tier=sm&share=abc`);
	assertEquals(assetMediaSrc(ref(), "original", "abc"), `/api/media/proxy/${ASSET_ID}?share=abc`);
});

Deno.test("assetMediaSrc inherits the share slug from the row's own address unless told none", () => {
	const shared = ref({ url: `/api/files/object/${ASSET_ID}?share=s1`, thumbnailUrl: null });
	assertEquals(assetMediaSrc(shared, "sm"), `/api/media/proxy/${ASSET_ID}?tier=sm&share=s1`);
	assertEquals(assetMediaSrc(shared, "sm", null), `/api/media/proxy/${ASSET_ID}?tier=sm`);
	const external = ref({ url: "https://cdn.example.com/a.png?share=x" });
	assertEquals(assetMediaSrc(external, "sm"), `/api/media/proxy/${ASSET_ID}?tier=sm`);
});

Deno.test("assetMediaSrc keeps a video's poster for a tier and proxies its original", () => {
	const poster = "data:image/jpeg;base64,AAAA";
	const video = ref({ kind: "video", thumbnailUrl: poster });
	assertEquals(assetMediaSrc(video, "sm"), poster);
	assertEquals(assetMediaSrc(video, "original"), `/api/media/proxy/${ASSET_ID}`);
	assertEquals(assetMediaSrc(ref({ kind: "video", thumbnailUrl: null }), "sm"), null);
});

Deno.test("assetMediaSrc falls back to the producer's URLs without stored bytes", () => {
	const fixture = ref({
		id: "fx-file-1",
		url: "https://images.example/a.jpg",
		thumbnailUrl: "https://images.example/a-sm.jpg",
	});
	assertEquals(assetMediaSrc(fixture, "sm"), "https://images.example/a-sm.jpg");
	assertEquals(assetMediaSrc(fixture), "https://images.example/a.jpg");
	assertEquals(
		assetMediaSrc(
			ref({ id: "fx-file-2", url: "https://images.example/b.jpg", thumbnailUrl: null }),
			"sm",
		),
		"https://images.example/b.jpg",
	);
	const pending = ref({ status: "scanning", thumbnailUrl: null, url: "#" });
	assertEquals(assetMediaSrc(pending, "sm"), null);
	assertEquals(assetMediaSrc(pending), null);
	const drive = ref({ source: "google_drive", thumbnailUrl: "https://drive.example/t.png" });
	assertEquals(assetMediaSrc(drive, "sm"), "https://drive.example/t.png");
});

Deno.test("assetMediaSrc never borrows a link's page URL as a picture", () => {
	const link = ref({
		source: "link",
		kind: "image",
		url: "https://example.com/page",
		thumbnailUrl: null,
	});
	assertEquals(assetMediaSrc(link, "sm"), null);
});

Deno.test("assetMediaSrc treats '#' and blank addresses as nothing", () => {
	const doc = ref({ id: "fx-doc", kind: "doc", url: "#", thumbnailUrl: "  " });
	assertEquals(assetMediaSrc(doc, "sm"), null);
	assertEquals(assetMediaSrc(doc), null);
});
// #endregion

// #region assetMediaSrcset
Deno.test("assetMediaSrcset lists the three library tiers for a stored raster image", () => {
	assertEquals(
		assetMediaSrcset(ref({ ext: "png" })),
		[
			`/api/media/proxy/${ASSET_ID}?tier=sm 320w`,
			`/api/media/proxy/${ASSET_ID}?tier=md 1280w`,
			`/api/media/proxy/${ASSET_ID}?tier=lg 2560w`,
		].join(", "),
	);
});

Deno.test("assetMediaSrcset scopes every candidate to the share slug", () => {
	const set = assetMediaSrcset(ref(), "s1") ?? "";
	assertEquals(set.split(", ").every((c) => c.includes("&share=s1 ")), true);
});

Deno.test("assetMediaSrcset is null for vectors, non-images and unstored rows", () => {
	assertEquals(assetMediaSrcset(ref({ ext: "SVG" })), null);
	assertEquals(assetMediaSrcset(ref({ kind: "video" })), null);
	assertEquals(assetMediaSrcset(ref({ id: "fx-file-1" })), null);
	assertEquals(assetMediaSrcset(ref({ source: "dropbox" })), null);
	assertEquals(assetMediaSrcset(ref({ status: "quarantined" })), null);
});
// #endregion

// #region assetPlaceholder
Deno.test("assetPlaceholder lifts an image's hash and average tone", () => {
	const metadata = AssetMetadataSchema.parse({
		version: 1,
		source: "server",
		extractedAt: "2026-10-10T00:00:00.000Z",
		media: {
			kind: "image",
			width: 640,
			height: 480,
			aspectRatio: 1.3333,
			blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
			colors: null,
		},
	});
	assertEquals(assetPlaceholder({ metadata }), {
		blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		color: null,
	});
});

Deno.test("assetPlaceholder is undefined without metadata", () => {
	assertEquals(assetPlaceholder({}), undefined);
	assertEquals(assetPlaceholder({ metadata: null }), undefined);
});
// #endregion
