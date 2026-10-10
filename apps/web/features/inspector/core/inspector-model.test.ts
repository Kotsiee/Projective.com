import { assertEquals } from "@std/assert";
import { type InspectAsset, InspectAssetSchema } from "@projective/types/files";
import {
	absoluteLink,
	accessDetails,
	embedDetails,
	exactBytes,
	fileDetails,
	fileOpenHref,
	initialPanelOpen,
	inspectorLink,
	metaLine,
	shortHash,
	visibilityText,
	workspaceCommand,
} from "./inspector-model.ts";
import { createInspectorShell, resolveShellOptions } from "./inspector-shell.ts";

const ID = "f3f21bc4-161f-4c1a-94d9-d1d0376bc346";

function asset(overrides: Partial<InspectAsset> = {}): InspectAsset {
	return InspectAssetSchema.parse({
		id: ID,
		name: "quadrants.png",
		ext: "png",
		mimeType: "image/png",
		category: "Image",
		categoryLabel: "Image",
		kind: "image",
		viewer: "image",
		language: null,
		modelFormat: null,
		delimiter: null,
		sizeBytes: 30316,
		sizeLabel: "29.6 KB",
		width: 1600,
		height: 900,
		durationMs: null,
		durationLabel: null,
		pageCount: null,
		peaks: null,
		blurhash: null,
		createdAt: "2026-10-01T10:00:00.000Z",
		dateLabel: "1 Oct 2026",
		owner: null,
		ownerType: "user",
		visibility: "private",
		access: "owner",
		canManage: true,
		src: `/api/media/proxy/${ID}`,
		previewSrc: null,
		downloadHref: `/api/media/proxy/${ID}?download=1`,
		share: null,
		shareUrl: null,
		downloadCount: 3,
		contentHash: null,
		...overrides,
	});
}

Deno.test("metaLine joins category, upper-cased extension and size", () => {
	assertEquals(metaLine(asset()), "Image · PNG · 29.6 KB");
	assertEquals(metaLine(asset({ ext: "" })), "Image · 29.6 KB");
});

Deno.test("exactBytes groups digits and handles the singular", () => {
	assertEquals(exactBytes(30316), "30,316 bytes");
	assertEquals(exactBytes(1), "1 byte");
});

Deno.test("shortHash keeps short hashes and elides long ones", () => {
	assertEquals(shortHash("abc"), "abc");
	assertEquals(shortHash("0123456789abcdefghijklmnop"), "0123456789…klmnop");
});

Deno.test("visibilityText says 'Only you' only to the manager", () => {
	assertEquals(visibilityText({ visibility: "private", canManage: true }), "Only you");
	assertEquals(visibilityText({ visibility: "private", canManage: false }), "Private");
	assertEquals(visibilityText({ visibility: "link", canManage: false }), "Anyone with the link");
});

Deno.test("fileDetails omits absent facts and appends canvas facts", () => {
	const rows = fileDetails(asset(), [{ label: "Aspect ratio", value: "16:9" }, {
		label: "Empty",
		value: " ",
	}]);
	assertEquals(rows.map((r) => r.key), ["name", "type", "format", "size", "dimensions", "fact-0"]);
	assertEquals(rows[3].secondary, "30,316 bytes");
	assertEquals(rows[4].value, "1600 × 900 px");

	const audio = fileDetails(
		asset({ width: null, height: null, durationLabel: "0:42", pageCount: 3, mimeType: "" }),
		[],
	);
	assertEquals(audio.map((r) => r.key), ["name", "type", "size", "duration", "pages"]);
});

Deno.test("accessDetails shows downloads only when the count is visible", () => {
	assertEquals(accessDetails(asset()).map((r) => r.key), ["visibility", "downloads"]);
	assertEquals(accessDetails(asset({ downloadCount: null })).map((r) => r.key), ["visibility"]);
});

Deno.test("inspectorLink carries the share slug only for share access", () => {
	const origin = "https://projective.example";
	assertEquals(inspectorLink(origin, asset({ share: "abc" })), `${origin}/inspect/${ID}`);
	assertEquals(
		inspectorLink(
			origin,
			asset({ access: "share", share: "abc", canManage: false, downloadCount: null }),
		),
		`${origin}/inspect/${ID}?share=abc`,
	);
});

Deno.test("absoluteLink prefixes same-origin paths only", () => {
	assertEquals(absoluteLink("https://p.example", "/share/x"), "https://p.example/share/x");
	assertEquals(absoluteLink("https://p.example", "share/x"), "https://p.example/share/x");
	assertEquals(
		absoluteLink("https://p.example", "https://other.example/a"),
		"https://other.example/a",
	);
});

Deno.test("initialPanelOpen: closed on mobile, else the stored choice, else open", () => {
	assertEquals(initialPanelOpen("1", true), false);
	assertEquals(initialPanelOpen("0", false), false);
	assertEquals(initialPanelOpen("1", false), true);
	assertEquals(initialPanelOpen(null, false), true);
	assertEquals(initialPanelOpen("garbage", false), true);
});

Deno.test("workspaceCommand maps bare keys and ignores modified presses", () => {
	const stroke = (
		key: string,
		mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
	) => ({
		key,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...mods,
	});
	assertEquals(workspaceCommand(stroke("f")), "fullscreen");
	assertEquals(workspaceCommand(stroke("I")), "panel");
	assertEquals(workspaceCommand(stroke("?")), "shortcuts");
	assertEquals(workspaceCommand(stroke("f", { ctrlKey: true })), null);
	assertEquals(workspaceCommand(stroke("r")), null);
});

Deno.test("shell: fail moves to error, announce re-fires identical messages, panel toggles", () => {
	const shell = createInspectorShell(asset());
	assertEquals(shell.status.value, "loading");
	shell.fail("  ");
	assertEquals(shell.status.value, "error");
	assertEquals(shell.error.value, "This preview couldn't be shown.");

	shell.announce("100%");
	const first = shell.announcement.value;
	shell.announce("100%");
	assertEquals(shell.announcement.value?.message, "100%");
	assertEquals(shell.announcement.value?.id === first?.id, false);
	shell.announce("   ");
	assertEquals(shell.announcement.value?.message, "100%");

	assertEquals(shell.panelOpen.value, true);
	shell.togglePanel();
	assertEquals(shell.panelOpen.value, false);

	let toggled = 0;
	shell.toggleFullscreen();
	shell.setFullscreenHandler(() => toggled++);
	shell.toggleFullscreen();
	assertEquals(toggled, 1);
});

Deno.test("fileOpenHref sends stored files to the inspector and everything else to its URL", () => {
	assertEquals(
		fileOpenHref({ id: ID, source: "supabase", status: "uploaded", url: "/x" }),
		`/inspect/${ID}`,
	);
	assertEquals(
		fileOpenHref({ id: ID, source: "link", status: "uploaded", url: "https://a.example" }),
		"https://a.example",
	);
	assertEquals(fileOpenHref({ id: ID, source: "supabase", status: "pending", url: "/x" }), "/x");
});

Deno.test("shell options default to the standalone page and freeze", () => {
	assertEquals(resolveShellOptions(), { urlSync: true, print: true, embedded: false });
	assertEquals(resolveShellOptions({ embedded: true, print: false }), {
		urlSync: true,
		print: false,
		embedded: true,
	});
	assertEquals(Object.isFrozen(resolveShellOptions()), true);

	const page = createInspectorShell(asset());
	assertEquals(page.options, { urlSync: true, print: true, embedded: false });
	assertEquals(page.panelOpen.value, true);

	const embedded = createInspectorShell(asset(), { urlSync: false, print: false, embedded: true });
	assertEquals(embedded.options, { urlSync: false, print: false, embedded: true });
	assertEquals(embedded.panelOpen.value, false);
});

Deno.test("embedDetails drops the name by default and honours omitted keys", () => {
	const facts = [{ label: "Aspect ratio", value: "16:9" }];
	assertEquals(embedDetails(asset(), facts).map((r) => r.key), [
		"type",
		"format",
		"size",
		"dimensions",
		"fact-0",
	]);
	assertEquals(
		embedDetails(asset(), facts, ["name", "type", "facts"]).map((r) => r.key),
		["format", "size", "dimensions"],
	);
	assertEquals(embedDetails(asset(), [], []).map((r) => r.key)[0], "name");
});
