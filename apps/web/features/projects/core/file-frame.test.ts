import { assertEquals, assertStrictEquals } from "@std/assert";
import { createModalStack } from "@ui/overlay/core/modal-stack.ts";
import type { AssetItem } from "../types/projects-types.ts";
import {
	FILE_FRAME_TRIGGER,
	fileFrameSeed,
	fileOpenIntent,
	openFileFrame,
	patchFile,
	seedFrame,
	snapshotFrame,
	takeFileTrigger,
} from "./file-frame.ts";

function asset(id: string, name = `${id}.png`): AssetItem {
	return {
		id,
		kind: "image",
		category: "Image",
		name,
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

Deno.test("file frame: push replaces the top, seeds the group and records the trigger beneath", () => {
	const stack = createModalStack<"review" | "file", { fileId?: string }>();
	const review = stack.open("review", "unit");
	const files = [asset("a"), asset("b"), asset("c")];
	const frame = openFileFrame(stack, "file", { fileId: "b" }, files, "b");

	assertEquals(stack.top.peek()?.uid, frame.uid);
	assertEquals(stack.depth.peek(), 2);
	assertEquals(frame.id, "b");
	assertEquals(stack.read(review.uid, FILE_FRAME_TRIGGER, null), "b");
	const seed = fileFrameSeed(stack, frame.uid);
	assertEquals(seed.files.map((f) => f.id), ["a", "b", "c"]);
	assertEquals(seed.startIndex, 1);
});

Deno.test("file frame: the cached group is a copy of the caller's array", () => {
	const stack = createModalStack<"file", undefined>();
	const files = [asset("a")];
	const frame = openFileFrame(stack, "file", undefined, files, "a", "open");
	files.push(asset("b"));
	assertEquals(fileFrameSeed(stack, frame.uid).files.length, 1);
});

Deno.test("file frame: open starts a new chain and records no trigger", () => {
	const stack = createModalStack<"review" | "file", undefined>();
	const review = stack.open("review", "unit");
	const frame = openFileFrame(stack, "file", undefined, [asset("a")], "a", "open");
	assertEquals(stack.depth.peek(), 1);
	assertEquals(stack.top.peek()?.uid, frame.uid);
	assertEquals(stack.has(review.uid, FILE_FRAME_TRIGGER), false);
});

Deno.test("file frame: a start id missing from the group opens on the first file", () => {
	const stack = createModalStack<"file", undefined>();
	const frame = openFileFrame(stack, "file", undefined, [asset("a"), asset("b")], "zz", "open");
	assertEquals(fileFrameSeed(stack, frame.uid).startIndex, 0);
	assertEquals(fileFrameSeed(stack, 999), { files: [], startIndex: 0 });
});

Deno.test("file frame: the trigger is read once, then cleared", () => {
	const stack = createModalStack<"review" | "file", undefined>();
	const review = stack.open("review", "unit");
	openFileFrame(stack, "file", undefined, [asset("a")], "a");
	stack.back();
	assertEquals(takeFileTrigger(stack, review.uid), "a");
	assertEquals(takeFileTrigger(stack, review.uid), null);
});

Deno.test("file frame: patchFile rewrites one file and keeps the others by reference", () => {
	const files = [asset("a"), asset("b")];
	const next = patchFile(files, "b", (f) => ({ ...f, starred: true }));
	assertStrictEquals(next[0], files[0]);
	assertEquals(next[1].starred, true);
	assertEquals(files[1].starred, false);
});

Deno.test("frame snapshot: carries written keys into a new frame, skipping unwritten ones", () => {
	const stack = createModalStack<"review", undefined>();
	const first = stack.open("review", "unit");
	stack.write(first.uid, "guidelines", "Tighten the kerning");
	stack.write(first.uid, "annotations", [{ id: "a-0" }]);
	const snapshot = snapshotFrame(stack, first.uid, ["guidelines", "annotations", "draftNote"]);
	assertEquals([...snapshot.keys()], ["guidelines", "annotations"]);

	const second = stack.open("review", "unit");
	assertEquals(stack.has(second.uid, "guidelines"), false);
	seedFrame(stack, second.uid, snapshot);
	assertEquals(stack.read(second.uid, "guidelines", ""), "Tighten the kerning");
	assertEquals(stack.has(second.uid, "draftNote"), false);
});

Deno.test("file frame: click intent follows the browser's new-tab convention", () => {
	const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false };
	assertEquals(fileOpenIntent(plain), "preview");
	assertEquals(fileOpenIntent({ ...plain, ctrlKey: true }), "tab");
	assertEquals(fileOpenIntent({ ...plain, metaKey: true }), "tab");
	assertEquals(fileOpenIntent({ ...plain, shiftKey: true }), "tab");
	assertEquals(fileOpenIntent({ ...plain, button: 1 }), "tab");
	assertEquals(fileOpenIntent({ ...plain, button: 2 }), null);
});
