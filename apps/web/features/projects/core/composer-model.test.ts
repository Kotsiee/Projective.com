import { assertEquals } from "@std/assert";
import type { DraftAttachment } from "../types/composer-types.ts";
import { canShareAsLink, toggleAttachmentMode } from "./composer-model.ts";

const card = (over: Partial<DraftAttachment>): DraftAttachment => ({
	id: "att-1",
	file: null,
	assetId: "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2",
	name: "brief.pdf",
	size: 1024,
	ext: "pdf",
	kind: "file",
	mode: "copy",
	canLink: true,
	...over,
});

Deno.test("only an upload in the sender's own personal library may be shared as a link", () => {
	assertEquals(canShareAsLink({ canManage: true, ownerType: "user", source: "supabase" }), true);
	assertEquals(canShareAsLink({ canManage: true, ownerType: "user", source: "link" }), false);
	assertEquals(canShareAsLink({ canManage: false, ownerType: "user", source: "supabase" }), false);
	assertEquals(canShareAsLink({ canManage: true, ownerType: "team", source: "supabase" }), false);
	assertEquals(
		canShareAsLink({ canManage: true, ownerType: "user", source: "google_drive" }),
		false,
	);
});

Deno.test("toggling switches one card between a copy and a link", () => {
	const tray = [card({}), card({ id: "att-2" })];
	const once = toggleAttachmentMode(tray, "att-1");
	assertEquals(once.map((a) => a.mode), ["link", "copy"]);
	assertEquals(toggleAttachmentMode(once, "att-1").map((a) => a.mode), ["copy", "copy"]);
});

Deno.test("a card that may not link stays a copy", () => {
	const tray = [card({ canLink: false })];
	assertEquals(toggleAttachmentMode(tray, "att-1")[0].mode, "copy");
});
