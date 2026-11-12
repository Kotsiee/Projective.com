import { assert, assertEquals, assertFalse } from "@std/assert";
import type { ModalFrame } from "@ui/overlay/core/modal-stack.ts";
import type { AssetItem } from "../types/projects-types.ts";
import { FILE_FRAME_TRIGGER, fileFrameSeed } from "./file-frame.ts";
import {
	addressingFrame,
	multiplierLabel,
	openTicketFile,
	panelFor,
	pushTicketPicker,
	registerTicketFileHost,
	stagesInPane,
	TICKET_LIBRARY_TRIGGER,
	TICKET_PICKER_ID,
	ticketFileHosted,
	ticketFileInput,
	type TicketFrameInput,
	type TicketFrameKind,
	ticketMetrics,
	ticketStack,
	ticketTabs,
} from "./ticket-view.ts";
import { newTicketCard } from "./ticket-model.ts";

function frame(
	uid: number,
	kind: TicketFrameKind,
	input: TicketFrameInput = {},
): ModalFrame<TicketFrameKind, TicketFrameInput> {
	return { uid, kind, id: String(uid), input };
}

function file(id: string): AssetItem {
	return {
		id,
		kind: "pdf",
		category: "Document",
		name: `${id}.pdf`,
		ext: "pdf",
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

Deno.test("ticket file input: inherits ticket, slug, path and the standalone posture", () => {
	const input = ticketFileInput(
		{ ticketId: "t1", slug: "tkt-abc", path: ["s", "u"], standalone: true, mode: "view" },
		"f1",
	);
	assertEquals(input, {
		fileId: "f1",
		ticketId: "t1",
		slug: "tkt-abc",
		path: ["s", "u"],
		standalone: true,
	});
	assertEquals(ticketFileInput(null, "f2"), { fileId: "f2" });
});

Deno.test("addressing frame: file frames are skipped down to the ticket or review", () => {
	const ticket = frame(1, "ticket", { slug: "tkt-a" });
	const review = frame(2, "review");
	assertEquals(addressingFrame([ticket, frame(3, "file")])?.uid, 1);
	assertEquals(addressingFrame([ticket, review, frame(4, "file")])?.uid, 2);
	assertEquals(addressingFrame([ticket])?.uid, 1);
	assertEquals(addressingFrame([frame(5, "file")]), null);
	assertEquals(addressingFrame([]), null);
});

Deno.test("addressing frame: a picker frame is skipped down to its ticket", () => {
	const ticket = frame(1, "ticket", { slug: "tkt-a" });
	assertEquals(addressingFrame([ticket, frame(2, "picker")])?.uid, 1);
	assertEquals(addressingFrame([frame(3, "picker")]), null);
});

Deno.test("pushTicketPicker: replaces the top ticket only, inherits its address, records the trigger", () => {
	ticketStack.close();
	assertFalse(pushTicketPicker(1));

	const ticket = ticketStack.open("ticket", "t1", {
		ticketId: "t1",
		slug: "tkt-a",
		standalone: true,
		mode: "view",
	});
	assertFalse(pushTicketPicker(ticket.uid));
	const boardOnly = registerTicketFileHost(false);
	assertFalse(pushTicketPicker(ticket.uid));
	boardOnly();

	const release = registerTicketFileHost(true);
	assertFalse(pushTicketPicker(ticket.uid + 100));
	assert(pushTicketPicker(ticket.uid));
	const top = ticketStack.top.peek();
	assertEquals(top?.kind, "picker");
	assertEquals(top?.id, TICKET_PICKER_ID);
	assertEquals(top?.input, { ticketId: "t1", slug: "tkt-a", standalone: true, mode: "view" });
	assertEquals(ticketStack.read(ticket.uid, FILE_FRAME_TRIGGER, null), TICKET_LIBRARY_TRIGGER);

	assertFalse(pushTicketPicker(ticket.uid));
	assertEquals(ticketStack.depth.peek(), 2);

	release();
	ticketStack.close();
});

Deno.test("file hosts: registration is counted per posture and released once", () => {
	assertFalse(ticketFileHosted(false));
	const a = registerTicketFileHost(false);
	const b = registerTicketFileHost(false);
	assert(ticketFileHosted(false));
	assertFalse(ticketFileHosted(true));
	a();
	a();
	assert(ticketFileHosted(false));
	b();
	assertFalse(ticketFileHosted(false));
});

Deno.test("openTicketFile: pushes over the ticket only when a host renders file frames", () => {
	ticketStack.close();
	const files = [file("a"), file("b")];
	assertFalse(openTicketFile(files, "a"));

	const ticket = ticketStack.open("ticket", "t1", { ticketId: "t1", slug: "tkt-a" });
	assertFalse(openTicketFile(files, "a"));
	assertEquals(ticketStack.depth.peek(), 1);

	const standaloneOnly = registerTicketFileHost(true);
	assertFalse(openTicketFile(files, "a"));
	standaloneOnly();

	const release = registerTicketFileHost(false);
	assert(openTicketFile(files, "b"));
	const top = ticketStack.top.peek();
	assertEquals(top?.kind, "file");
	assertEquals(top?.input, { fileId: "b", ticketId: "t1", slug: "tkt-a" });
	assertEquals(ticketStack.read(ticket.uid, FILE_FRAME_TRIGGER, null), "b");
	assertEquals(top ? fileFrameSeed(ticketStack, top.uid).startIndex : -1, 1);

	release();
	ticketStack.close();
});

// #region Panels and tabs by posture
Deno.test("a saved ticket reads activity beside Details and the selected stage beside Stages", () => {
	assertEquals(panelFor("details", "view", true), "activity");
	assertEquals(panelFor("stages", "view", true), "stage");
	assertEquals(panelFor("finances", "view", true), null);
});

Deno.test("a ticket being created composes its stages beside Details, with no Stages tab", () => {
	const card = newTicketCard(null, [], "USD");
	assertEquals(panelFor("details", "create", true), "composer");
	assert(stagesInPane("create", true));
	assertFalse(ticketTabs(card, "create", true, true).some((t) => t.key === "stages"));
	assertEquals(ticketMetrics(card, "create", true).find((m) => m.key === "stages")?.target, null);
});

Deno.test("without room for a panel the stages are worked in the Stages tab, on both postures", () => {
	const card = newTicketCard(null, [], "USD");
	assertEquals(panelFor("details", "create", false), null);
	assertEquals(panelFor("stages", "view", false), null);
	assert(ticketTabs(card, "create", true, false).some((t) => t.key === "stages"));
	assertEquals(
		ticketMetrics(card, "create", false).find((m) => m.key === "stages")?.target,
		"stages",
	);
});

Deno.test("the price multiplier prints as arithmetic, two places where it needs them", () => {
	assertEquals(multiplierLabel(0.75), "×0.75");
	assertEquals(multiplierLabel(1.5), "×1.5");
	assertEquals(multiplierLabel(1), "×1");
});
// #endregion
