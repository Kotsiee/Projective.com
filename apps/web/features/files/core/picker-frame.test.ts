import { assertEquals } from "@std/assert";
import { createModalStack } from "@ui/overlay/core/modal-stack.ts";
import type { AssetItem } from "../types/file-types.ts";
import { handOffPicks, PICKER_HANDOFF_KEY, takePicks } from "./picker-frame.ts";

function asset(id: string): AssetItem {
	return {
		id,
		kind: "image",
		category: "Image",
		name: `${id}.png`,
		ext: "png",
		url: "#",
		thumbnailUrl: null,
		sizeBytes: 1,
		sizeLabel: "1 B",
		width: null,
		height: null,
		durationLabel: null,
		channelId: null,
		channelName: null,
		channelKind: null,
		messageId: null,
		messageText: null,
		messageAudioUrl: null,
		sender: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		timeLabel: "12:00 AM",
		dayLabel: "Today",
		dateLabel: "Oct 1 · 12:00 AM",
		starred: false,
		source: "supabase",
		status: "uploaded",
		visibility: "private",
		ownerType: "user",
		ownerId: "u1",
		folderId: null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: null,
		link: null,
		shareSlug: null,
		downloadCount: 0,
		downloadedByViewer: false,
		canManage: true,
	};
}

const ids = (assets: readonly AssetItem[]) => assets.map((a) => a.id);

Deno.test("picker handoff: appends across picks and de-duplicates by id", () => {
	const stack = createModalStack<"ticket" | "picker">();
	const ticket = stack.open("ticket", "t1");
	handOffPicks(stack, ticket.uid, [asset("a"), asset("b")]);
	handOffPicks(stack, ticket.uid, [asset("b"), asset("c"), asset("c")]);
	assertEquals(ids(stack.read<AssetItem[]>(ticket.uid, PICKER_HANDOFF_KEY, [])), ["a", "b", "c"]);
});

Deno.test("picker handoff: an empty pick writes nothing", () => {
	const stack = createModalStack<"ticket">();
	const ticket = stack.open("ticket", "t1");
	handOffPicks(stack, ticket.uid, []);
	assertEquals(stack.has(ticket.uid, PICKER_HANDOFF_KEY), false);
});

Deno.test("picker handoff: take reads once, then clears", () => {
	const stack = createModalStack<"ticket">();
	const ticket = stack.open("ticket", "t1");
	assertEquals(takePicks(stack, ticket.uid), []);
	handOffPicks(stack, ticket.uid, [asset("a")]);
	assertEquals(ids(takePicks(stack, ticket.uid)), ["a"]);
	assertEquals(takePicks(stack, ticket.uid), []);
});

Deno.test("picker handoff: entries are isolated per frame", () => {
	const stack = createModalStack<"ticket">();
	const first = stack.open("ticket", "t1");
	const second = stack.push("ticket", "t2");
	handOffPicks(stack, first.uid, [asset("a")]);
	assertEquals(takePicks(stack, second.uid), []);
	assertEquals(ids(takePicks(stack, first.uid)), ["a"]);
});

Deno.test("picker handoff: popping the picker frame keeps the requester's picks", () => {
	const stack = createModalStack<"ticket" | "picker">();
	const ticket = stack.open("ticket", "t1");
	stack.push("picker", "lib");
	handOffPicks(stack, ticket.uid, [asset("a")]);
	assertEquals(stack.back(), true);
	assertEquals(ids(takePicks(stack, ticket.uid)), ["a"]);
});

Deno.test("picker handoff: closing the chain drops picks nobody took", () => {
	const stack = createModalStack<"ticket" | "picker">();
	const ticket = stack.open("ticket", "t1");
	stack.push("picker", "lib");
	handOffPicks(stack, ticket.uid, [asset("a")]);
	stack.close();
	assertEquals(takePicks(stack, ticket.uid), []);
});
