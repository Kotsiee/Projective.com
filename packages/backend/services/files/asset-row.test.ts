import { assertEquals, assertFalse } from "@std/assert";
import { AssetItemSchema, type AssetMetadata } from "@projective/types/files";
import { type FileItem, FileItemSchema } from "@projective/types/projects";
import { assetAddress, type ItemRow, toAssetItem, withMediaFacts } from "./asset-row.ts";

const ID = "f3f21bc4-161f-4c1a-94d9-d1d0376bc346";

function row(over: Partial<ItemRow> = {}): ItemRow {
	return {
		id: ID,
		owner_user_id: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
		owner_type: "user",
		owner_entity_id: null,
		folder_id: null,
		bucket_id: "personal",
		storage_path: "950d68d1-8777-4bbe-ae59-3343e3e7f858/poster.png",
		display_name: "poster.png",
		original_name: "poster.png",
		mime_type: "image/png",
		size_bytes: 30316,
		category: "Image",
		metadata: {},
		status: "uploaded",
		source: "supabase",
		visibility: "private",
		purpose: null,
		starred: false,
		content_hash: null,
		hash_sampled: false,
		download_count: 0,
		external_web_url: null,
		link_url: null,
		link_domain: null,
		link_title: null,
		link_description: null,
		link_favicon_url: null,
		link_scan_status: null,
		link_scanned_at: null,
		created_at: "2026-10-09T12:00:00.000Z",
		...over,
	};
}

const CTX = {
	viewerId: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
	folderPaths: new Map<string, string[]>(),
	downloaded: new Set<string>(),
	shareSlugs: new Map<string, string>(),
	now: Date.parse("2026-10-10T00:00:00.000Z"),
};

const IMAGE_METADATA: AssetMetadata = {
	version: 1,
	source: "client",
	extractedAt: "2026-10-09T12:00:00.000Z",
	media: {
		kind: "image",
		width: 1600,
		height: 900,
		aspectRatio: 1.7778,
		blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		colors: null,
		animated: false,
		vector: false,
		hasAlpha: null,
	},
	notes: [],
};

// #region assetAddress
Deno.test("assetAddress: a stored private image streams through the proxy, thumbnail at sm", () => {
	assertEquals(assetAddress(row(), "image"), {
		url: `/api/media/proxy/${ID}`,
		thumbnailUrl: `/api/media/proxy/${ID}?tier=sm`,
	});
});

Deno.test("assetAddress: a public-bucket object is proxied too — no storage host or path", () => {
	const previous = Deno.env.get("SUPABASE_PUBLIC_URL");
	Deno.env.set("SUPABASE_PUBLIC_URL", "https://storage.example.test");
	try {
		const address = assetAddress(
			row({ bucket_id: "avatars", storage_path: "u/brand.png" }),
			"image",
		);
		const json = JSON.stringify(address);
		assertFalse(json.includes("storage"));
		assertFalse(json.includes("avatars"));
		assertEquals(address.url, `/api/media/proxy/${ID}`);
	} finally {
		if (previous === undefined) Deno.env.delete("SUPABASE_PUBLIC_URL");
		else Deno.env.set("SUPABASE_PUBLIC_URL", previous);
	}
});

Deno.test("assetAddress: a non-image has no thumbnail; an unsettled upload has no address", () => {
	assertEquals(assetAddress(row({ mime_type: "video/webm" }), "video"), {
		url: `/api/media/proxy/${ID}`,
		thumbnailUrl: null,
	});
	for (const status of ["pending_upload", "scanning", "error", "quarantined"]) {
		assertEquals(assetAddress(row({ status }), "image"), { url: "#", thumbnailUrl: null });
	}
});

Deno.test("assetAddress: a link and a mounted file keep their own URLs, trimmed", () => {
	assertEquals(assetAddress(row({ source: "link", link_url: " https://example.org/a " }), "link"), {
		url: "https://example.org/a",
		thumbnailUrl: null,
	});
	assertEquals(
		assetAddress(
			row({ source: "google_drive", external_web_url: "https://drive.example/x" }),
			"doc",
		),
		{ url: "https://drive.example/x", thumbnailUrl: null },
	);
	assertEquals(assetAddress(row({ source: "dropbox", external_web_url: null }), "doc"), {
		url: "#",
		thumbnailUrl: null,
	});
});
// #endregion

// #region toAssetItem + withMediaFacts
Deno.test("toAssetItem: a library row's assetId is its own id", () => {
	const item = AssetItemSchema.parse(toAssetItem(row(), CTX));
	assertEquals([item.id, item.assetId], [ID, ID]);
	assertEquals(item.url, `/api/media/proxy/${ID}`);
});

Deno.test("toAssetItem: a key that is not a files.items id carries no assetId", () => {
	const item = AssetItemSchema.parse(toAssetItem(row({ id: "fixture-1" }), CTX));
	assertEquals(item.assetId, null);
});

Deno.test("withMediaFacts keeps a FileItem a FileItem and overlays the envelope", () => {
	const base: FileItem = FileItemSchema.parse({
		...toAssetItem(row(), CTX),
		id: "link-row-1",
		channelId: "c-1",
		channelName: "Discussion",
		channelKind: "general",
		messageId: "m-1",
		messageText: "",
		messageAudioUrl: null,
		sender: { id: "u-1", name: "Chloe", avatar: null, handle: "chloewinters" },
	});
	const merged = withMediaFacts(base, IMAGE_METADATA);
	FileItemSchema.parse(merged);
	assertEquals([merged.width, merged.height], [1600, 900]);
	assertEquals(merged.metadata?.media.kind, "image");
	assertEquals(merged.sender.name, "Chloe");
});

Deno.test("withMediaFacts leaves a row nobody extracted untouched, with no envelope key", () => {
	const base = toAssetItem(row(), CTX);
	const merged = withMediaFacts(base, {});
	assertEquals([merged.width, merged.height], [null, null]);
	assertFalse("metadata" in merged && merged.metadata !== undefined);
});
// #endregion
