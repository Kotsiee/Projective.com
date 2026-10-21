import { assertEquals } from "@std/assert";
import { type AssetListPage, AssetListPageSchema } from "@projective/types/files";
import { type FolderRow, type ItemRow, toAssetFolder, toAssetItem } from "./asset-row.ts";
import { sealArchivedPage } from "./archived-drive.ts";

const MEMBER = "950d68d1-8777-4bbe-ae59-3343e3e7f858";
const TEAM = "3d1c1a52-6e0f-4a43-9e57-7a2b1f6c0b11";

function item(id: string): ItemRow {
	return {
		id,
		owner_user_id: MEMBER,
		owner_type: "team",
		owner_entity_id: TEAM,
		folder_id: null,
		bucket_id: "workspace",
		storage_path: `${TEAM}/${id}/brief.pdf`,
		display_name: "brief.pdf",
		original_name: "brief.pdf",
		mime_type: "application/pdf",
		size_bytes: 40960,
		category: "Document",
		metadata: {},
		status: "uploaded",
		source: "supabase",
		visibility: "link",
		purpose: "library",
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
		created_at: "2026-10-20T09:00:00.000Z",
	};
}

const FOLDER: FolderRow = {
	id: "a5f0c0de-0000-4000-8000-000000000001",
	name: "Brand",
	parent_folder_id: null,
	path: [],
	owner_type: "team",
	owner_user_id: MEMBER,
	owner_entity_id: TEAM,
	source: "supabase",
	external_folder_id: null,
	visibility: "private",
	created_at: "2026-10-20T09:00:00.000Z",
	updated_at: "2026-10-20T09:00:00.000Z",
};

/** A drive page as the member who uploaded everything in it reads it: every row theirs to manage. */
function memberPage(): AssetListPage {
	const ids = ["f3f21bc4-161f-4c1a-94d9-d1d0376bc346", "0b8e6f1a-2c4d-4e5f-8a9b-0c1d2e3f4a5b"];
	const ctx = {
		viewerId: MEMBER,
		folderPaths: new Map<string, string[]>(),
		downloaded: new Set<string>(),
		shareSlugs: new Map(ids.map((id) => [id, `shr-${id.slice(0, 8)}`])),
		now: Date.parse("2026-10-21T00:00:00.000Z"),
	};
	return {
		scope: "workspace",
		subjectId: TEAM,
		folderId: null,
		items: ids.map((id) => toAssetItem(item(id), ctx)),
		folders: [toAssetFolder(FOLDER, { itemCount: 2, sizeBytes: 81920 }, { viewerId: MEMBER, shareSlug: "shr-brand" })],
		crumbs: [{ id: null, label: "Atelier Nova", href: "/teams/atelier-nova/files" }],
		hasMore: false,
		nextCursor: null,
		total: 2,
		viewerId: MEMBER,
		readOnly: false,
		quota: null,
	};
}

Deno.test("the fixture is a member's own drive — every row is theirs to manage", () => {
	const page = memberPage();
	assertEquals(page.items.every((a) => a.canManage), true);
	assertEquals(page.folders.every((f) => f.canManage), true);
});

Deno.test("an archived entity's drive answers read-only, with every asset and folder unmanaged", () => {
	const sealed = sealArchivedPage(memberPage());
	assertEquals(sealed.readOnly, true);
	assertEquals(sealed.items.map((a) => a.canManage), [false, false]);
	assertEquals(sealed.items.map((a) => a.shareSlug), [null, null]);
	assertEquals(sealed.folders.map((f) => [f.canManage, f.shareSlug]), [[false, null]]);
	assertEquals(AssetListPageSchema.safeParse(sealed).success, true);
});

Deno.test("sealing keeps everything a reader sees: names, visibility, crumbs, totals", () => {
	const page = memberPage();
	const sealed = sealArchivedPage(page);
	assertEquals(sealed.items.map((a) => [a.id, a.name, a.visibility]), page.items.map((a) => [a.id, a.name, a.visibility]));
	assertEquals(sealed.folders.map((f) => f.name), ["Brand"]);
	assertEquals(sealed.crumbs, page.crumbs);
	assertEquals([sealed.total, sealed.hasMore, sealed.scope], [2, false, "workspace"]);
});
