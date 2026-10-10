import { assertEquals } from "@std/assert";
import type { AttachmentSource } from "@projective/types/projects";
import {
	canRenameFile,
	clampPage,
	goToMessageMode,
	pickSource,
	previewAssetId,
	previewDownloadHref,
	type PreviewFile,
	previewIconName,
	previewInspectHref,
	previewMetaLine,
	previewShareOf,
	previewShortcuts,
	resolvePreviewContext,
	sourceFromFile,
	sourceLookup,
	stepPage,
} from "./preview-model.ts";

// #region Fixtures
const ASSET = "8b0c5a3e-1f2d-4c6b-9a7e-2d3f4a5b6c7d";
const LINK_ROW = "11111111-2222-4333-8444-555555555555";
const ROOM = "22222222-3333-4444-8555-666666666666";

function file(overrides: Partial<PreviewFile> = {}): PreviewFile {
	return {
		id: ASSET,
		assetId: ASSET,
		source: "supabase",
		status: "uploaded",
		kind: "image",
		ext: "png",
		url: `/api/media/proxy/${ASSET}`,
		thumbnailUrl: `/api/media/proxy/${ASSET}?tier=sm`,
		sizeBytes: 2_400_000,
		sizeLabel: "2.4 MB",
		width: 2400,
		height: 1600,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		sender: null,
		createdAt: "2026-10-09T12:00:00.000Z",
		dayLabel: "Today",
		timeLabel: "12:00 PM",
		link: null,
		...overrides,
	};
}

const SENDER = { id: "u-1", name: "Chloe Winters", avatar: null, handle: "chloewinters" };

function source(overrides: Partial<AttachmentSource> = {}): AttachmentSource {
	return {
		messageId: "m-1",
		kind: "dm",
		conversationId: "c-1",
		channelLabel: null,
		sender: { id: "u-1", name: "Chloe Winters", handle: "chloewinters", avatarSrc: null },
		createdAt: "2026-10-09T12:00:00.000Z",
		dayLabel: "Today",
		timeLabel: "12:00 PM",
		excerpt: "Here it is",
		href: "/messages/c-1?m=m-1",
		...overrides,
	};
}
// #endregion

// #region Identity
Deno.test("previewAssetId prefers assetId and needs stored, uploaded bytes", () => {
	assertEquals(previewAssetId(file({ id: LINK_ROW })), ASSET);
	assertEquals(previewAssetId(file({ assetId: null })), ASSET);
	assertEquals(previewAssetId(file({ id: "fx-1", assetId: undefined })), null);
	assertEquals(previewAssetId(file({ status: "scanning" })), null);
	assertEquals(previewAssetId(file({ source: "link" })), null);
});

Deno.test("previewShareOf reads the slug off a same-origin address only", () => {
	assertEquals(previewShareOf(file({ url: `/api/media/proxy/${ASSET}?share=s1` })), "s1");
	assertEquals(
		previewShareOf(file({ url: "https://x.test/a?share=s1", thumbnailUrl: null })),
		null,
	);
	assertEquals(previewShareOf(file()), null);
});

Deno.test("previewInspectHref and previewDownloadHref go through the inspector and the proxy", () => {
	assertEquals(previewInspectHref(file()), `/inspect/${ASSET}`);
	assertEquals(previewDownloadHref(file()), `/api/media/proxy/${ASSET}?download=1`);
	const shared = file({ url: `/api/media/proxy/${ASSET}?share=s1` });
	assertEquals(previewInspectHref(shared), `/inspect/${ASSET}?share=s1`);
	assertEquals(previewDownloadHref(shared), `/api/media/proxy/${ASSET}?download=1&share=s1`);
});

Deno.test("previewDownloadHref falls back to the row's own file, never a stub or a link", () => {
	const fixture = file({ id: "fx-1", assetId: undefined, url: "https://cdn.test/a.png" });
	assertEquals(previewDownloadHref(fixture), "https://cdn.test/a.png");
	assertEquals(previewDownloadHref(file({ id: "fx-1", assetId: undefined, url: "#" })), null);
	assertEquals(previewDownloadHref(file({ source: "link", url: "https://x.test" })), null);
	assertEquals(previewInspectHref(fixture), null);
});
// #endregion

// #region Paging
Deno.test("clampPage and stepPage stay inside the set without wrapping", () => {
	assertEquals(clampPage(5, 3), 2);
	assertEquals(clampPage(-1, 3), 0);
	assertEquals(clampPage(1, 0), 0);
	assertEquals(clampPage(Number.NaN, 3), 0);
	assertEquals(stepPage(0, -1, 3), 0);
	assertEquals(stepPage(1, 1, 3), 2);
	assertEquals(stepPage(2, 1, 3), 2);
});

Deno.test("canRenameFile: the sender for a posted file, the manager for an uploaded one", () => {
	assertEquals(canRenameFile({ sender: SENDER, canManage: false }, "u-1"), true);
	assertEquals(canRenameFile({ sender: SENDER, canManage: true }, "u-2"), false);
	assertEquals(canRenameFile({ sender: SENDER, canManage: false }, ""), false);
	assertEquals(canRenameFile({ sender: null, canManage: true }, "u-2"), true);
	assertEquals(canRenameFile({ sender: null, canManage: false }, "u-2"), false);
});
// #endregion

// #region Context
Deno.test("resolvePreviewContext keeps a named context and infers one otherwise", () => {
	assertEquals(resolvePreviewContext({ kind: "ticket" }, file(), "prj-1"), { kind: "ticket" });
	assertEquals(
		resolvePreviewContext(undefined, file({ channelId: "c-1", channelKind: "dm" }), "c-1"),
		{ kind: "messages", conversationId: "c-1" },
	);
	assertEquals(
		resolvePreviewContext(
			undefined,
			file({ channelId: "c-1", channelKind: "general", messageId: "m-1" }),
			"c-1",
		),
		{ kind: "messages", conversationId: "c-1" },
	);
	assertEquals(
		resolvePreviewContext(
			undefined,
			file({ channelId: ROOM, channelKind: "stage", messageId: "m-1" }),
			"prj-1",
		),
		{ kind: "project", projectSlug: "prj-1" },
	);
	assertEquals(resolvePreviewContext(undefined, file(), ""), { kind: "files" });
});

Deno.test("sourceLookup narrows to the conversation, or a room uuid, and skips submissions", () => {
	assertEquals(sourceLookup(file(), { kind: "messages", conversationId: "dm-chloe" }), {
		assetId: ASSET,
		conversationId: "dm-chloe",
	});
	assertEquals(sourceLookup(file({ channelId: ROOM }), { kind: "project", projectSlug: "p" }), {
		assetId: ASSET,
		conversationId: ROOM,
	});
	assertEquals(sourceLookup(file({ channelId: "ch-1" }), { kind: "files" }), {
		assetId: ASSET,
		conversationId: null,
	});
	assertEquals(sourceLookup(file(), { kind: "submission" }), null);
	assertEquals(sourceLookup(file({ id: "fx", assetId: undefined }), { kind: "files" }), null);
});

Deno.test("sourceFromFile paints a posted row and routes rooms by slug only", () => {
	const posted = file({
		channelId: "c-1",
		channelKind: "dm",
		channelName: "Chloe",
		messageId: "m-1",
		messageText: "  Here   it\nis ",
		sender: SENDER,
	});
	const dm = sourceFromFile(posted, { kind: "messages", conversationId: "c-1" });
	assertEquals(dm?.href, "/messages/c-1?m=m-1");
	assertEquals(dm?.excerpt, "Here it is");
	assertEquals(dm?.kind, "dm");
	assertEquals(dm?.channelLabel, null);
	assertEquals(dm?.sender.handle, "chloewinters");

	const slugRoom = file({ channelId: "stg-abc", channelKind: "stage", messageId: "m-2" });
	const bySlug = sourceFromFile({ ...slugRoom, sender: SENDER, channelName: "Design" }, {
		kind: "project",
		projectSlug: "prj-1",
	});
	assertEquals(bySlug?.href, "/projects/prj-1/stg-abc/chat?m=m-2");
	assertEquals(bySlug?.channelLabel, "Design");

	const byUuid = sourceFromFile({ ...slugRoom, channelId: ROOM, sender: SENDER }, {
		kind: "project",
		projectSlug: "prj-1",
	});
	assertEquals(byUuid?.href, null);
	assertEquals(sourceFromFile(file(), { kind: "files" }), null);
});

Deno.test("pickSource prefers the lookup's row for the file's message, else its newest", () => {
	const instant = sourceFromFile(
		file({ channelId: "c-1", channelKind: "dm", messageId: "m-2", sender: SENDER }),
		{ kind: "messages", conversationId: "c-1" },
	);
	const rows = [source({ messageId: "m-1" }), source({ messageId: "m-2", href: "/x" })];
	assertEquals(pickSource(rows, instant, "m-2")?.href, "/x");
	assertEquals(pickSource(rows, instant, "m-9")?.messageId, "m-1");
	assertEquals(pickSource([], instant, "m-2"), instant);
	assertEquals(pickSource(null, null, null), null);
});

Deno.test("goToMessageMode jumps inside the same feed, else navigates when it has a route", () => {
	const s = source({ messageId: "m-1" });
	assertEquals(goToMessageMode(s, "m-1", true), "jump");
	assertEquals(goToMessageMode(s, "m-2", true), "navigate");
	assertEquals(goToMessageMode(s, "m-1", false), "navigate");
	assertEquals(goToMessageMode({ ...s, href: null }, "m-2", true), null);
});
// #endregion

// #region Shortcuts
Deno.test("previewShortcuts lists the canvas keys, paging for a group, then Escape", () => {
	const canvas = [{ keys: ["+"], label: "Zoom in" }];
	assertEquals(previewShortcuts(canvas, false).map((s) => s.keys[0]), ["+", "Esc"]);
	assertEquals(previewShortcuts([], true).map((s) => s.keys[0]), ["←", "→", "Esc"]);
});
// #endregion

// #region Header
Deno.test("previewIconName follows the canvas, else the kind", () => {
	assertEquals(previewIconName("file", "table"), "table-grid");
	assertEquals(previewIconName("doc", "model"), "cube-3d");
	assertEquals(previewIconName("code", "unsupported"), "code-brackets");
	assertEquals(previewIconName("audio"), "volume");
	assertEquals(previewIconName("archive", null), "archive-box");
	const stray: string = "document";
	assertEquals(previewIconName(stray as PreviewFile["kind"]), "attachment");
});

Deno.test("previewMetaLine reads Format · Size · shape from the row or the inspector", () => {
	assertEquals(previewMetaLine(file()), "PNG · 2.4 MB · 2400 × 1600");
	assertEquals(
		previewMetaLine(
			file({ kind: "video", ext: "mp4", width: null, height: null, durationLabel: "0:42" }),
		),
		"MP4 · 2.4 MB · 0:42",
	);
	assertEquals(previewMetaLine(file({ sizeBytes: 0, width: null, height: null })), "PNG");
	assertEquals(
		previewMetaLine(file(), {
			ext: "webp",
			sizeLabel: "1 MB",
			width: null,
			height: null,
			durationLabel: null,
		}),
		"WEBP · 1 MB",
	);
	const stored = {
		ext: "webm",
		sizeLabel: "106 KB",
		width: null,
		height: null,
		durationLabel: null,
	};
	assertEquals(
		previewMetaLine(file({ kind: "video" }), stored, [
			{ label: "Resolution", value: "640 × 360 px" },
			{ label: "Duration", value: "0:04" },
		]),
		"WEBM · 106 KB · 640 × 360",
	);
	assertEquals(
		previewMetaLine(file({ kind: "audio" }), stored, [{ label: "Duration", value: "0:03" }]),
		"WEBM · 106 KB · 0:03",
	);
	assertEquals(
		previewMetaLine(
			file({
				kind: "link",
				link: {
					url: "https://figma.com/f",
					domain: "figma.com",
					title: "F",
					description: null,
					faviconUrl: null,
					scanStatus: "safe",
					scannedAt: null,
				},
			}),
		),
		"figma.com",
	);
});
// #endregion
