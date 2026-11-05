import { assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import type { ReadActor } from "../read-actor.ts";
import type { EntryDeps } from "./live-entries.ts";
import { inviteToEvent, readClashes, withdrawInvitation } from "./live-invitations.ts";
import { stubSchedulingClient, type StubStore } from "./scheduling-stub-client.ts";

/**
 * live-invitations_test — the service half of a guest list. The rules are the database doors', which
 * `supabase/probes/event_invitations.sql` exercises; this pins what is left: the call each door gets,
 * a refusal arriving in the door's own words, and the clash door's rows reaching a surface as epoch ms.
 */

// #region Fixtures
const ACTOR: ReadActor & { accessToken: string } = {
	userId: "0a0a0a0a-0000-4000-8000-000000000001",
	contextId: "",
	contextType: "personal",
	accessToken: "token",
};
const EVENT = "e0e0e0e0-0000-4000-8000-000000000001";
const SEAT = "a0a0a0a0-0000-4000-8000-000000000001";
const GUEST = "0b0b0b0b-0000-4000-8000-000000000002";
const REREAD = { id: EVENT, title: "Review" } as CalendarEvent;

type Answer = { data?: unknown; error?: { code: string; message: string } };

function harness(answer: Answer = { data: 1 }, found = true) {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const respond = (name: string) => (args: Record<string, unknown>) => {
		calls.push({ name, args });
		return answer;
	};
	const deps: EntryDeps = {
		db: stubSchedulingClient({} as StubStore, {
			invite_to_event: respond("invite_to_event"),
			withdraw_invitation: respond("withdraw_invitation"),
			fn_detect_event_clashes: respond("fn_detect_event_clashes"),
		}).client,
		reread: () => Promise.resolve(found ? [REREAD] : []),
		now: 0,
	};
	return { calls, deps };
}
// #endregion

Deno.test("an invitation goes to the door, and answers with the entry re-read", async () => {
	const { calls, deps } = harness();
	const res = await inviteToEvent({ eventId: EVENT, userIds: [GUEST], emails: [] }, deps);
	assertEquals(res.ok, true);
	assertEquals(res.data?.event, REREAD);
	assertEquals(calls, [{
		name: "invite_to_event",
		args: { p_event: EVENT, p_users: [GUEST], p_emails: [] },
	}]);
});

Deno.test("a withdrawal names the seat, so one guest goes and not the list", async () => {
	const { calls, deps } = harness();
	await withdrawInvitation({ eventId: EVENT, attendeeId: SEAT }, deps);
	assertEquals(calls[0].args, { p_event: EVENT, p_attendee: SEAT });
});

Deno.test("a door's refusal reads in its own words, and a stranger's entry answers 403", async () => {
	const refused = harness({
		error: { code: "55000", message: "event: this entry can't take invitations" },
	});
	const res = await inviteToEvent({ eventId: EVENT, userIds: [GUEST], emails: [] }, refused.deps);
	assertEquals([res.status, res.message], [409, "This entry can't take invitations."]);

	const stranger = harness({ error: { code: "42501", message: "event: not yours" } });
	const denied = await withdrawInvitation({ eventId: EVENT, attendeeId: SEAT }, stranger.deps);
	assertEquals(denied.status, 403);
});

Deno.test("an entry the reader can no longer read back says so, rather than claiming success", async () => {
	const res = await inviteToEvent(
		{ eventId: EVENT, userIds: [GUEST], emails: [] },
		harness({}, false).deps,
	);
	assertEquals(res.ok, false);
	assertEquals(res.status, 500);
});

Deno.test("clashes are asked as the caller, and reach a surface as epoch ms", async () => {
	const { calls, deps } = harness({
		data: [{
			kind: "blackout",
			id: EVENT,
			title: "Leave",
			startsAt: "2026-11-05T10:00:00+00:00",
			endsAt: "2026-11-05T11:00:00+00:00",
		}],
	});
	const start = Date.parse("2026-11-05T10:30:00Z");
	const res = await readClashes({ start, end: start + 1_000 }, ACTOR, deps);
	assertEquals(res.data?.clashes, [{
		kind: "blackout",
		id: EVENT,
		title: "Leave",
		start: Date.parse("2026-11-05T10:00:00Z"),
		end: Date.parse("2026-11-05T11:00:00Z"),
	}]);
	assertEquals(calls[0].args.p_user_id, ACTOR.userId);
	assertEquals(calls[0].args.p_exclude_event_id, null);
});
