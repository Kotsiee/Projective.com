import { assertEquals, assertStrictEquals } from "@std/assert";
import type { DataExportState } from "@projective/types/org";
import {
	archiveSize,
	type DataExportSimulation,
	dataExportView,
	simulatedDataExport,
} from "./data-export-model.ts";

const NOW = new Date(Date.UTC(2026, 10, 18, 12));
const LATER = "2026-11-19T12:00:00.000Z";
const EARLIER = "2026-11-17T12:00:00.000Z";

const NONE: DataExportState = {
	latest: null,
	nextRequestAt: null,
	signInFresh: true,
	accountClosing: false,
};

function latest(
	status: "pending" | "building" | "ready" | "expired" | "failed",
	expiresAt: string | null = null,
) {
	return {
		id: "r1",
		status,
		requestedAt: EARLIER,
		readyAt: status === "ready" || status === "expired" ? EARLIER : null,
		expiresAt,
		byteSize: status === "ready" ? 2048 : null,
		failureReason: status === "failed" ? "build_failed" as const : null,
	};
}

Deno.test("data export view — nothing read is unavailable; nothing asked is a plain request", () => {
	assertEquals(dataExportView(null, NOW), { kind: "unavailable" });
	assertEquals(dataExportView(NONE, NOW), {
		kind: "request",
		last: null,
		failureReason: null,
		next: { at: null, needsSignIn: false, closing: false },
	});
});

Deno.test("data export view — pending and building both read as preparing", () => {
	for (const status of ["pending", "building"] as const) {
		assertEquals(dataExportView({ ...NONE, latest: latest(status) }, NOW), {
			kind: "preparing",
			requestedAt: EARLIER,
		});
	}
});

Deno.test("data export view — a ready archive downloads until its expiry, then reads expired", () => {
	const ready = { ...NONE, latest: latest("ready", LATER), nextRequestAt: LATER };
	assertEquals(dataExportView(ready, NOW), {
		kind: "ready",
		expiresAt: LATER,
		byteSize: 2048,
		next: { at: LATER, needsSignIn: false, closing: false },
	});
	const past = { ...NONE, latest: latest("ready", EARLIER) };
	assertEquals(dataExportView(past, NOW).kind, "request");
	assertEquals(dataExportView({ ...NONE, latest: latest("expired", EARLIER) }, NOW), {
		kind: "request",
		last: "expired",
		failureReason: null,
		next: { at: null, needsSignIn: false, closing: false },
	});
});

Deno.test("data export view — a failed request says why and can be asked again at once", () => {
	assertEquals(dataExportView({ ...NONE, latest: latest("failed") }, NOW), {
		kind: "request",
		last: "failed",
		failureReason: "build_failed",
		next: { at: null, needsSignIn: false, closing: false },
	});
});

Deno.test("data export view — a stale sign-in and a passed limit are carried; closing blocks a request", () => {
	const stale = dataExportView({ ...NONE, signInFresh: false, nextRequestAt: EARLIER }, NOW);
	assertEquals(stale.kind === "request" ? stale.next : null, {
		at: null,
		needsSignIn: true,
		closing: false,
	});
	assertEquals(dataExportView({ ...NONE, accountClosing: true }, NOW), { kind: "closing" });
	const readyClosing = dataExportView({
		...NONE,
		latest: latest("ready", LATER),
		accountClosing: true,
	}, NOW);
	assertEquals(readyClosing.kind === "ready" ? readyClosing.next.closing : null, true);
});

Deno.test("archive size — read in the person's locale", () => {
	assertEquals(archiveSize(null, "en-GB"), null);
	assertEquals(archiveSize(512, "en-GB"), "512 byte");
	assertEquals(archiveSize(1_482_113, "en-GB"), "1.5 MB");
});

Deno.test("data export simulation — auto passes the real read through; every position renders a view", () => {
	assertStrictEquals(simulatedDataExport("auto", NONE, NOW), NONE);
	const expected: Record<Exclude<DataExportSimulation, "auto">, string> = {
		none: "request",
		preparing: "preparing",
		ready: "ready",
		expired: "request",
		failed: "request",
		reauth: "request",
		closing: "closing",
	};
	for (const [mode, kind] of Object.entries(expected)) {
		assertEquals(
			dataExportView(simulatedDataExport(mode as DataExportSimulation, null, NOW), NOW).kind,
			kind,
			mode,
		);
	}
});
