import { assertEquals } from "@std/assert";
import type { ReadActor } from "../read-actor.ts";
import { type DbAnswer, ReportsBackendService, type ReportsDeps } from "./ReportsBackendService.ts";

/*
 * Filing a report (T&S R1). The database's half — immutability, the reporter rule, one pending report
 * per subject, the RLS reads — is proven by supabase/probes/reports_sink.sql. These tests prove the
 * service's: the subject is read under the reporter's JWT and a subject they cannot read files
 * nothing; the snapshot comes from the stored row; a reported file's bytes are frozen; the door's
 * refusals map to statuses.
 */

// #region Fakes
const REPORTER: ReadActor = {
	userId: "11111111-1111-4111-8111-111111111111",
	contextId: "11111111-1111-4111-8111-111111111111",
	contextType: "personal",
	accessToken: "reporter-jwt",
};
const AUTHOR = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";

const MESSAGE = {
	id: SUBJECT,
	sender_user_id: AUTHOR,
	body: "pay me direct",
	thread_id: "55555555-5555-4555-8555-555555555555",
	project_id: null,
	reply_to_id: null,
	created_at: "2026-11-23T10:00:00Z",
	deleted_at: null,
};

function fakes(row: Record<string, unknown> | null, door?: DbAnswer<never>["error"]) {
	const calls = { reads: [] as unknown[][], doors: [] as unknown[][], copies: [] as unknown[][] };
	const deps: ReportsDeps = {
		readSubject(...args) {
			calls.reads.push(args);
			return Promise.resolve({ data: row, error: null });
		},
		callDoor(...args) {
			calls.doors.push(args);
			return Promise.resolve(
				door ? { data: null, error: door } : {
					data: { id: REPORT, status: "pending", created_at: "2026-11-23T10:01:00Z" },
					error: null,
				},
			);
		},
		copyEvidence(...args) {
			calls.copies.push(args);
			return Promise.resolve(true);
		},
		now: () => new Date("2026-11-23T10:01:00Z"),
	};
	return { deps, calls };
}
// #endregion

Deno.test("a subject the reporter cannot read answers 404 and files nothing", async () => {
	const { deps, calls } = fakes(null);
	const res = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "harassment" },
		deps,
	);
	assertEquals(res.status, 404);
	assertEquals(calls.reads, [["reporter-jwt", "dm_message", SUBJECT]]);
	assertEquals(calls.doors.length, 0);
});

Deno.test("a readable subject is filed with a snapshot of the stored row and its author", async () => {
	const { deps, calls } = fakes(MESSAGE);
	const res = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "contact_leakage" },
		deps,
	);
	assertEquals(res.status, 201);
	assertEquals(res.data, { id: REPORT, status: "pending", createdAt: "2026-11-23T10:01:00Z" });
	assertEquals(calls.doors, [["file_report", {
		p_reporter: REPORTER.userId,
		p_subject_type: "dm_message",
		p_subject_id: SUBJECT,
		p_reason: "contact_leakage",
		p_reported_user: AUTHOR,
		p_snapshot: { subjectType: "dm_message", capturedAt: "2026-11-23T10:01:00.000Z", row: MESSAGE },
	}]]);
});

Deno.test("a person cannot choose the fragmentation detector's reason", async () => {
	const { deps, calls } = fakes(MESSAGE);
	const res = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "evasion_fragmentation" },
		deps,
	);
	assertEquals(res.status, 422);
	assertEquals(calls.reads.length, 0);
});

Deno.test("a signed-out caller is told to sign in", async () => {
	const { deps } = fakes(MESSAGE);
	const res = await ReportsBackendService.fileReport(
		{ userId: "", contextId: "", contextType: "personal" },
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "harassment" },
		deps,
	);
	assertEquals(res.status, 401);
});

Deno.test("a reported file's bytes are frozen at evidence/{report}/{file}", async () => {
	const { deps, calls } = fakes({
		id: SUBJECT,
		owner_user_id: AUTHOR,
		display_name: "brief.pdf",
		mime_type: "application/pdf",
		content_hash: "abc",
		bucket_id: "personal",
		storage_path: `${AUTHOR}/brief.pdf`,
		link_url: null,
		created_at: "2026-11-23T09:00:00Z",
		updated_at: "2026-11-23T09:00:00Z",
	});
	const res = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "file", subjectId: SUBJECT, reason: "intellectual_property" },
		deps,
	);
	assertEquals(res.status, 201);
	assertEquals(calls.copies, [["personal", `${AUTHOR}/brief.pdf`, REPORT, SUBJECT]]);
});

Deno.test("the door's refusals map to 409 and 429", async () => {
	const already = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "harassment" },
		fakes(MESSAGE, { code: "23505" }).deps,
	);
	assertEquals(already.status, 409);
	const capped = await ReportsBackendService.fileReport(
		REPORTER,
		{ subjectType: "dm_message", subjectId: SUBJECT, reason: "harassment" },
		fakes(MESSAGE, { code: "PR429" }).deps,
	);
	assertEquals(capped.status, 429);
});

Deno.test("an automated finding refuses anything beyond ids, categories and scores", async () => {
	const { deps, calls } = fakes(null);
	const res = await ReportsBackendService.fileAutomatedFinding({
		detector: "fragmentation",
		subjectType: "dm_message",
		subjectId: SUBJECT,
		reportedUserId: AUTHOR,
		reason: "evasion_fragmentation",
		evidence: {
			ids: [SUBJECT],
			categories: ["phone"],
			scores: { phone: 0.92 },
			text: "07700 900123",
		},
	}, deps);
	assertEquals(res.status, 422);
	assertEquals(calls.doors.length, 0);
});
