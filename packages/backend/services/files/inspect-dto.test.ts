import { assert, assertEquals, assertFalse } from "@std/assert";
import { type AssetMetadata, InspectAssetSchema, type InspectOwner } from "@projective/types/files";
import { type ItemRow, toAssetItem } from "./asset-row.ts";
import {
	extensionOf,
	inspectAccess,
	type InspectSource,
	isAssetId,
	liveShareSlug,
	toInspectAsset,
	toInspectOwner,
} from "./inspect-dto.ts";

/**
 * The inspector DTO, pinned on what a viewer must never receive (a storage URL, someone else's share
 * link, a download count that is not theirs) and on the rendition rule that decides what the canvas draws.
 */

// #region Fixtures

const ID = "f3f21bc4-161f-4c1a-94d9-d1d0376bc346";
const OWNER = "950d68d1-8777-4bbe-ae59-3343e3e7f858";
const OTHER = "2e4274fb-e76b-4640-ad31-c66d7fbea842";
const NOW = Date.parse("2026-10-09T12:00:00Z");
const PERSON: InspectOwner = { handle: "chloewinters", name: "Chloe Winters", avatarSrc: null };

function row(overrides: Partial<ItemRow> = {}): ItemRow {
	return {
		id: ID,
		owner_user_id: OWNER,
		owner_type: "user",
		owner_entity_id: null,
		folder_id: null,
		bucket_id: "personal",
		storage_path: `${OWNER}/library/quadrants.png`,
		display_name: "quadrants.png",
		original_name: "quadrants.png",
		mime_type: "image/png",
		size_bytes: "30316",
		category: "Image",
		metadata: {},
		status: "uploaded",
		source: "supabase",
		visibility: "private",
		purpose: "library",
		starred: false,
		content_hash: "abc123",
		hash_sampled: false,
		download_count: 4,
		external_web_url: null,
		link_url: null,
		link_domain: null,
		link_title: null,
		link_description: null,
		link_favicon_url: null,
		link_scan_status: null,
		link_scanned_at: null,
		created_at: "2026-10-01T09:30:00Z",
		...overrides,
	};
}

function source(
	r: ItemRow,
	viewerId: string,
	overrides: Partial<InspectSource> = {},
): InspectSource {
	const item = toAssetItem(r, {
		viewerId,
		folderPaths: new Map(),
		downloaded: new Set(),
		shareSlugs: new Map(),
		now: NOW,
	});
	return {
		item,
		fileName: r.display_name ?? "",
		mimeType: r.mime_type,
		access: inspectAccess({ viaShare: false, viewerId, ownerUserId: r.owner_user_id }),
		share: null,
		renditionAvailable: false,
		owner: PERSON,
		shareSlug: null,
		...overrides,
	};
}

function envelope(media: AssetMetadata["media"]): AssetMetadata {
	return {
		version: 1,
		source: "client",
		extractedAt: "2026-10-01T09:30:00.000Z",
		media,
		notes: [],
	};
}

// #endregion

// #region Projection

Deno.test("toInspectAsset gives the owner proxy addresses, their share link and their download count", () => {
	const dto = InspectAssetSchema.parse(toInspectAsset(source(row(), OWNER, {
		renditionAvailable: true,
		shareSlug: "AbCdEfGhIjKlMnOpQrStUv",
	})));
	assertEquals(dto.access, "owner");
	assertEquals(dto.canManage, true);
	assertEquals(dto.viewer, "image");
	assertEquals(dto.ext, "png");
	assertEquals(dto.categoryLabel, "Image");
	assertEquals(dto.sizeBytes, 30316);
	assertEquals(dto.src, `/api/media/proxy/${ID}`);
	assertEquals(dto.previewSrc, `/api/media/proxy/${ID}?tier=lg`);
	assertEquals(dto.downloadHref, `/api/media/proxy/${ID}?download=1`);
	assertEquals(dto.shareUrl, "/share/AbCdEfGhIjKlMnOpQrStUv");
	assertEquals(dto.downloadCount, 4);
	assertEquals(dto.contentHash, "abc123");
});

Deno.test("toInspectAsset withholds the share link and download count from a member", () => {
	const dto = InspectAssetSchema.parse(
		toInspectAsset(source(row(), OTHER, { shareSlug: "AbCdEfGhIjKlMnOpQrStUv" })),
	);
	assertEquals(dto.access, "member");
	assertEquals(dto.canManage, false);
	assertEquals(dto.shareUrl, null);
	assertEquals(dto.downloadCount, null);
});

Deno.test("toInspectAsset carries a share slug onto every derived address", () => {
	const dto = InspectAssetSchema.parse(toInspectAsset(source(row(), "", {
		access: "share",
		share: "slug_1",
		renditionAvailable: true,
	})));
	assertEquals(dto.access, "share");
	assertEquals(dto.share, "slug_1");
	assertEquals(dto.src, `/api/media/proxy/${ID}?share=slug_1`);
	assertEquals(dto.previewSrc, `/api/media/proxy/${ID}?tier=lg&share=slug_1`);
	assertEquals(dto.downloadHref, `/api/media/proxy/${ID}?download=1&share=slug_1`);
});

Deno.test("toInspectAsset never exposes a public bucket's storage URL", () => {
	const previous = Deno.env.get("SUPABASE_PUBLIC_URL");
	Deno.env.set("SUPABASE_PUBLIC_URL", "https://storage.example.test");
	try {
		const r = row({ bucket_id: "avatars", visibility: "public", storage_path: "u/brand/logo.png" });
		const s = source(r, "");
		assertEquals(s.item.url, `/api/media/proxy/${ID}`);
		const json = JSON.stringify(InspectAssetSchema.parse(toInspectAsset(s)));
		assertFalse(json.includes("storage"));
		assertFalse(json.includes("avatars"));
		assertFalse(json.includes("u/brand"));
		assertEquals(JSON.parse(json).access, "public");
	} finally {
		if (previous === undefined) Deno.env.delete("SUPABASE_PUBLIC_URL");
		else Deno.env.set("SUPABASE_PUBLIC_URL", previous);
	}
});

Deno.test("toInspectAsset draws a non-browser image through its rendition, or not at all", () => {
	const heic = row({ display_name: "IMG_0001.HEIC", mime_type: "image/heic" });
	const without = InspectAssetSchema.parse(toInspectAsset(source(heic, OWNER)));
	assertEquals(without.viewer, "unsupported");
	assertEquals(without.src, `/api/media/proxy/${ID}`);
	assertEquals(without.previewSrc, null);

	const withLg = InspectAssetSchema.parse(
		toInspectAsset(source(heic, OWNER, { renditionAvailable: true })),
	);
	assertEquals(withLg.viewer, "image");
	assertEquals(withLg.src, `/api/media/proxy/${ID}?tier=lg`);
	assertEquals(withLg.previewSrc, `/api/media/proxy/${ID}?tier=lg`);
});

Deno.test("toInspectAsset types a bare display name by its stored MIME", () => {
	const r = row({ display_name: "Halcyon Motion — logo", mime_type: "image/png" });
	const dto = InspectAssetSchema.parse(toInspectAsset(source(r, "")));
	assertEquals(dto.ext, "");
	assertEquals(dto.viewer, "image");
	assertEquals(dto.name, "Halcyon Motion — logo");
});

Deno.test("toInspectAsset resolves language, model format and delimiter from the name", () => {
	const code = InspectAssetSchema.parse(
		toInspectAsset(source(row({ display_name: "main.ts", mime_type: "video/mp2t" }), OWNER)),
	);
	assertEquals([code.viewer, code.language], ["code", "typescript"]);
	const model = InspectAssetSchema.parse(
		toInspectAsset(source(row({ display_name: "chair.glb", mime_type: "" }), OWNER)),
	);
	assertEquals([model.viewer, model.modelFormat, model.mimeType], [
		"model",
		"glb",
		"application/octet-stream",
	]);
	const table = InspectAssetSchema.parse(
		toInspectAsset(
			source(row({ display_name: "rows.tsv", mime_type: "text/tab-separated-values" }), OWNER),
		),
	);
	assertEquals([table.viewer, table.delimiter], ["table", "\t"]);
});

Deno.test("toInspectAsset reads media facts from the extraction envelope", () => {
	const audio = row({
		display_name: "take.wav",
		mime_type: "audio/wav",
		metadata: envelope({
			kind: "audio",
			durationMs: 61_000,
			durationLabel: "1:01",
			peaks: [0.1, 0.5, 1],
			sampleRate: 48_000,
			channels: 2,
		}),
	});
	const a = InspectAssetSchema.parse(toInspectAsset(source(audio, OWNER)));
	assertEquals([a.viewer, a.durationMs, a.durationLabel, a.peaks], ["audio", 61_000, "1:01", [
		0.1,
		0.5,
		1,
	]]);
	assertEquals([a.width, a.height], [null, null]);

	const silent = row({
		display_name: "take.wav",
		mime_type: "audio/wav",
		metadata: envelope({
			kind: "audio",
			durationMs: 0,
			durationLabel: "0:00",
			peaks: [],
			sampleRate: null,
			channels: null,
		}),
	});
	assertEquals(InspectAssetSchema.parse(toInspectAsset(source(silent, OWNER))).peaks, null);

	const pdf = row({
		display_name: "brief.pdf",
		mime_type: "application/pdf",
		metadata: envelope({
			kind: "document",
			pageCount: 12,
			posterDataUrl: null,
			blurhash: null,
			width: 1240,
			height: 1754,
		}),
	});
	const p = InspectAssetSchema.parse(toInspectAsset(source(pdf, OWNER)));
	assertEquals([p.viewer, p.pageCount, p.width, p.height, p.durationMs], [
		"pdf",
		12,
		1240,
		1754,
		null,
	]);

	const image = row({
		metadata: envelope({
			kind: "image",
			width: 640,
			height: 480,
			aspectRatio: 1.3333,
			blurhash: "LEHV6nWB2yk8",
			colors: null,
			animated: false,
			vector: false,
			hasAlpha: true,
		}),
	});
	const i = InspectAssetSchema.parse(toInspectAsset(source(image, OWNER)));
	assertEquals([i.width, i.height, i.blurhash], [640, 480, "LEHV6nWB2yk8"]);
});

// #endregion

// #region Pieces

Deno.test("inspectAccess distinguishes share, owner, member and public", () => {
	assertEquals(inspectAccess({ viaShare: true, viewerId: OWNER, ownerUserId: OWNER }), "share");
	assertEquals(inspectAccess({ viaShare: false, viewerId: OWNER, ownerUserId: OWNER }), "owner");
	assertEquals(inspectAccess({ viaShare: false, viewerId: OTHER, ownerUserId: OWNER }), "member");
	assertEquals(inspectAccess({ viaShare: false, viewerId: "", ownerUserId: OWNER }), "public");
});

Deno.test("toInspectOwner names the owner, proxies the avatar, and has nobody without a directory entry", () => {
	const profile = { handle: "chloewinters", name: " Chloe  Winters ", avatar_file_id: ID };
	assertEquals(toInspectOwner(profile), {
		handle: "chloewinters",
		name: "Chloe Winters",
		avatarSrc: `/api/media/proxy/${ID}?tier=sm`,
	});
	assertEquals(toInspectOwner({ ...profile, name: "", avatar_file_id: null }), {
		handle: "chloewinters",
		name: "@chloewinters",
		avatarSrc: null,
	});
	assertEquals(toInspectOwner({ ...profile, avatar_file_id: "not-a-uuid" })?.avatarSrc, null);
	assertEquals(toInspectOwner({ handle: null, name: null, avatar_file_id: null }), null);
	assertEquals(toInspectOwner(null), null);
});

Deno.test("liveShareSlug picks the newest link that would still resolve", () => {
	const base = { expires_at: null, download_limit: null, download_count: 0 };
	assertEquals(liveShareSlug([], NOW), null);
	assertEquals(
		liveShareSlug([
			{ ...base, slug: "old", created_at: "2026-09-01T00:00:00Z" },
			{
				...base,
				slug: "newest-expired",
				created_at: "2026-10-08T00:00:00Z",
				expires_at: "2026-10-09T00:00:00Z",
			},
			{
				...base,
				slug: "newest-exhausted",
				created_at: "2026-10-07T00:00:00Z",
				download_limit: 2,
				download_count: 2,
			},
			{
				...base,
				slug: "live",
				created_at: "2026-10-05T00:00:00Z",
				expires_at: "2026-11-01T00:00:00Z",
			},
		], NOW),
		"live",
	);
});

Deno.test("extensionOf and isAssetId", () => {
	assertEquals(extensionOf("photo.final.JPG"), "jpg");
	assertEquals(extensionOf("Dockerfile"), "");
	assertEquals(extensionOf(".env"), "");
	assertEquals(extensionOf("a/b/c.tar.gz"), "gz");
	assert(isAssetId(ID));
	assert(isAssetId(ID.toUpperCase()));
	assertFalse(isAssetId("prj-abc"));
	assertFalse(isAssetId(`${ID}x`));
});

// #endregion
