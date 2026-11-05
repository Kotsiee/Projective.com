import { assert, assertEquals, assertRejects } from "@std/assert";
import { ROOM_ADAPTERS, type RoomFacts, RoomProviderError } from "./adapters.ts";

/*
 * What each provider is asked and what its answer becomes (Decision #383). A wrong field here shuts an
 * attendee out of a room or loses the evidence that they came, so the request bodies are pinned too.
 * All of this runs on a fake `fetch`: no provider has been called.
 */

// #region Fake provider
interface RequestBody {
	settings: Record<string, unknown>;
	config: Record<string, unknown>;
	lobbyBypassSettings: Record<string, unknown>;
	[field: string]: unknown;
}

interface Seen {
	url: string;
	method: string;
	body: RequestBody | null;
	auth: string | null;
}

type Reply = (seen: Seen) => { status?: number; json?: unknown };

async function provider(reply: Reply, run: (seen: Seen[]) => Promise<void>): Promise<void> {
	const real = globalThis.fetch;
	const seen: Seen[] = [];
	globalThis.fetch = ((input: string, init?: RequestInit) => {
		const s = {
			url: String(input),
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : null,
			auth: new Headers(init?.headers).get("authorization"),
		};
		seen.push(s);
		const { status = 200, json = {} } = reply(s);
		return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(json), { status }));
	}) as typeof fetch;
	try {
		await run(seen);
	} finally {
		globalThis.fetch = real;
	}
}

const ROOM: RoomFacts = {
	roomId: "room-1",
	title: "Portfolio review",
	startsAt: "2026-11-05T10:00:00.000Z",
	endsAt: "2026-11-05T10:45:00.000Z",
	hostAccount: "host-account",
};
// #endregion

// #region Zoom
Deno.test("zoom: a room lets an attendee in without the host, and a licensed host gets registration", () =>
	provider(
		(s) =>
			s.url.endsWith("/users/me")
				? { json: { type: 2 } }
				: { status: 201, json: { id: 123, host_id: "zhost", join_url: "https://zoom.us/j/123", password: "pw" } },
		async (seen) => {
			const minted = await ROOM_ADAPTERS.zoom.create("tok", ROOM);
			assertEquals(minted, {
				meetingId: "123",
				hostId: "zhost",
				joinUrl: "https://zoom.us/j/123",
				passcode: "pw",
				registration: true,
			});
			const body = seen[1].body!;
			assertEquals(body.settings.join_before_host, true);
			assertEquals(body.settings.waiting_room, false);
			assertEquals(body.settings.approval_type, 0);
			assertEquals(body.start_time, "2026-11-05T10:00:00Z");
			assertEquals(body.duration, 45);
			assertEquals(seen[1].auth, "Bearer tok");
			assert(!("start_url" in minted));
		},
	));

Deno.test("zoom: a Basic host gets no registration, because Zoom would refuse it", () =>
	provider(
		(s) =>
			s.url.endsWith("/users/me")
				? { json: { type: 1 } }
				: { status: 201, json: { id: 1, join_url: "https://zoom.us/j/1" } },
		async (seen) => {
			const minted = await ROOM_ADAPTERS.zoom.create("tok", ROOM);
			assertEquals(minted.registration, false);
			assertEquals(minted.hostId, "host-account");
			assertEquals(seen[1].body!.settings.approval_type, 2);
		},
	));

Deno.test("zoom: past participants read across pages, a guest has no account, a stretch with no leave stays open", () =>
	provider(
		(s) =>
			s.url.includes("next_page_token=more")
				? { json: { participants: [{ user_id: "9", join_time: "2026-11-05T10:05:00Z" }] } }
				: {
					json: {
						next_page_token: "more",
						participants: [{
							id: "zhost",
							user_email: "h@example.test",
							join_time: "2026-11-05T10:00:00Z",
							leave_time: "2026-11-05T10:40:00Z",
						}],
					},
				},
		async () => {
			const rows = await ROOM_ADAPTERS.zoom.attendance("tok", "123");
			assertEquals(rows.length, 2);
			assertEquals(rows[0].accountId, "zhost");
			assertEquals(rows[0].leftAt, "2026-11-05T10:40:00Z");
			assertEquals(rows[1].accountId, null);
			assertEquals(rows[1].leftAt, null);
		},
	));

Deno.test("zoom: no record means nobody came; a paid-plan refusal is a failed read, not an empty room", async () => {
	await provider(() => ({ status: 404, json: { code: 3001 } }), async () => {
		assertEquals(await ROOM_ADAPTERS.zoom.attendance("tok", "123"), []);
	});
	await provider(() => ({ status: 400, json: { code: 200, message: "Only available for paid users" } }), async () => {
		const error = await assertRejects(() => ROOM_ADAPTERS.zoom.attendance("tok", "123"), RoomProviderError);
		assertEquals(error.code, "200");
	});
});

Deno.test("zoom: the host's link is read fresh, and a personal link carries the registrant", () =>
	provider(
		(s) =>
			s.url.endsWith("/registrants")
				? { status: 201, json: { registrant_id: "reg-1", join_url: "https://zoom.us/w/me" } }
				: { json: { start_url: "https://zoom.us/s/1?zak=abc", join_url: "https://zoom.us/j/1" } },
		async (seen) => {
			assertEquals(await ROOM_ADAPTERS.zoom.hostLink!("tok", "1"), "https://zoom.us/s/1?zak=abc");
			assertEquals(
				await ROOM_ADAPTERS.zoom.register!("tok", "1", { email: "a@example.test", firstName: "Ada" }),
				{ registrantId: "reg-1", joinUrl: "https://zoom.us/w/me" },
			);
			assertEquals(seen[1].body as unknown, { email: "a@example.test", first_name: "Ada" });
		},
	));

Deno.test("zoom: closing a meeting already gone is done, and a refusal says whether trying again can help", async () => {
	await provider(() => ({ status: 404, json: { code: 3001 } }), () => ROOM_ADAPTERS.zoom.close!("tok", "1"));
	await provider(() => ({ status: 403, json: { code: 4711 } }), async () => {
		const error = await assertRejects(() => ROOM_ADAPTERS.zoom.move!("tok", "1", ROOM), RoomProviderError);
		assertEquals(error.final, true);
	});
	await provider(() => ({ status: 429, json: {} }), async () => {
		const error = await assertRejects(() => ROOM_ADAPTERS.zoom.move!("tok", "1", ROOM), RoomProviderError);
		assertEquals(error.final, false);
	});
});
// #endregion

// #region Google Meet
Deno.test("meet: an open space writes nothing to a calendar, and the host is the account behind it", () =>
	provider(
		() => ({ json: { name: "spaces/abc", meetingUri: "https://meet.google.com/abc-defg-hij" } }),
		async (seen) => {
			const minted = await ROOM_ADAPTERS.google.create("tok", ROOM);
			assertEquals(minted.meetingId, "spaces/abc");
			assertEquals(minted.hostId, "users/host-account");
			assertEquals(seen.length, 1);
			assert(seen[0].url.startsWith("https://meet.googleapis.com/v2/spaces"));
			assertEquals(seen[0].body!.config.accessType, "OPEN");
			assertEquals(ROOM_ADAPTERS.google.move, undefined);
		},
	));

Deno.test("meet: attendance walks record, participant and session", () =>
	provider(
		(s) => {
			if (s.url.includes("/conferenceRecords?filter=")) {
				return { json: { conferenceRecords: [{ name: "conferenceRecords/r1" }] } };
			}
			if (s.url.includes("/participantSessions")) {
				return {
					json: { participantSessions: [{ startTime: "2026-11-05T10:00:00Z", endTime: "2026-11-05T10:30:00Z" }] },
				};
			}
			return {
				json: {
					participants: [
						{ name: "conferenceRecords/r1/participants/1", signedinUser: { user: "users/host-account" } },
						{ name: "conferenceRecords/r1/participants/2", anonymousUser: { displayName: "Guest" } },
					],
				},
			};
		},
		async (seen) => {
			const rows = await ROOM_ADAPTERS.google.attendance("tok", "spaces/abc");
			assertEquals(rows.length, 2);
			assertEquals(rows[0].accountId, "users/host-account");
			assertEquals(rows[1].accountId, null);
			assertEquals(rows[1].key, "conferenceRecords/r1/participants/2");
			assert(decodeURIComponent(seen[0].url).includes('space.name = "spaces/abc"'));
		},
	));
// #endregion

// #region Microsoft Teams
Deno.test("teams: createOrGet retries to the same meeting, then the lobby opens to everyone", () =>
	provider(
		(s) =>
			s.method === "PATCH"
				? {}
				: {
					status: 201,
					json: {
						id: "m1",
						joinWebUrl: "https://teams.microsoft.com/l/m1",
						participants: { organizer: { identity: { user: { id: "aad-host" } } } },
					},
				},
		async (seen) => {
			const minted = await ROOM_ADAPTERS.microsoft_teams.create("tok", ROOM);
			assertEquals(minted.hostId, "aad-host");
			assertEquals(seen[0].body!.externalId, "room-1");
			assertEquals(seen[1].body!.lobbyBypassSettings.scope, "everyone");
		},
	));

Deno.test("teams: a tenant that forbids the lobby setting still gets its room; an outage retries", async () => {
	const meeting = { id: "m1", joinWebUrl: "https://teams.microsoft.com/l/m1" };
	await provider((s) => s.method === "PATCH" ? { status: 403, json: { error: { code: "Forbidden" } } } : { json: meeting }, async () => {
		assertEquals((await ROOM_ADAPTERS.microsoft_teams.create("tok", ROOM)).meetingId, "m1");
	});
	await provider((s) => s.method === "PATCH" ? { status: 503, json: {} } : { json: meeting }, async () => {
		await assertRejects(() => ROOM_ADAPTERS.microsoft_teams.create("tok", ROOM), RoomProviderError);
	});
});

Deno.test("teams: a personal account is refused for good, so the host is told rather than retried", () =>
	provider(() => ({ status: 403, json: { error: { code: "Forbidden" } } }), async () => {
		const error = await assertRejects(() => ROOM_ADAPTERS.microsoft_teams.create("tok", ROOM), RoomProviderError);
		assertEquals(error.final, true);
		assertEquals(error.code, "Forbidden");
	}));

Deno.test("teams: every interval of every report is a stretch, across pages", () =>
	provider(
		(s) => {
			if (s.url.endsWith("/attendanceReports")) return { json: { value: [{ id: "r1" }] } };
			if (s.url.includes("next")) {
				return {
					json: {
						value: [{
							emailAddress: "a@example.test",
							attendanceIntervals: [{ joinDateTime: "2026-11-05T10:10:00Z", leaveDateTime: "2026-11-05T10:20:00Z" }],
						}],
					},
				};
			}
			return {
				json: {
					"@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
					value: [{
						identity: { id: "aad-host" },
						attendanceIntervals: [
							{ joinDateTime: "2026-11-05T10:00:00Z", leaveDateTime: "2026-11-05T10:05:00Z" },
							{ joinDateTime: "2026-11-05T10:06:00Z", leaveDateTime: "2026-11-05T10:44:00Z" },
						],
					}],
				},
			};
		},
		async () => {
			const rows = await ROOM_ADAPTERS.microsoft_teams.attendance("tok", "m1");
			assertEquals(rows.length, 3);
			assertEquals(rows[0].accountId, "aad-host");
			assertEquals(rows[2].email, "a@example.test");
		},
	));
// #endregion
