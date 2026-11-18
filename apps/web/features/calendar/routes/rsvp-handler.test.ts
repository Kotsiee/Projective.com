import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { ok } from "@server/services/ServiceResult.ts";
import { GuestBackendService } from "@server/services/scheduling/GuestBackendService.ts";
import { RoomBackendService } from "@server/services/integrations/RoomBackendService.ts";
import { refuseCrossSitePageWrite } from "@web/utils/csrf.ts";
import { handler } from "./rsvp-handler.ts";

/**
 * `/rsvp/:token`'s form posts are origin-checked (PRD-C12): the token is in the URL, so without the
 * root middleware's page write guard a form on another site could answer an invitation, mail a code
 * or opt an address out for any token it holds. Each press runs the guard, then the handler, as the
 * root middleware chains them.
 */

// #region Harness
type Handler = (ctx: unknown) => unknown;
type PageAnswer = {
	data: Record<string, unknown>;
	status?: number;
	headers?: Record<string, string>;
};

const BASE = "https://app.example.test";
const EVIL = "https://evil.example";
const ROUTE = "/rsvp/:token";
const TOKEN = "0123456789abcdef".repeat(4);
const PATH = `/rsvp/${TOKEN}`;

/** What a browser sends for a form posted from this page, which is served `no-referrer`. */
const OWN_PAGE = { origin: "null", "sec-fetch-site": "same-origin" };

let clients = 0;

function context(req: Request) {
	clients += 1;
	return {
		req,
		url: new URL(req.url),
		params: { token: TOKEN },
		state: {} as Record<string, unknown>,
		info: { remoteAddr: { transport: "tcp", hostname: `10.0.0.${clients}`, port: 1 } },
		next: () => Promise.resolve(new Response(null, { status: 599 })),
	};
}

function form(headers: Record<string, string>, fields: Record<string, string>): Request {
	return new Request(`${BASE}${PATH}`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
		body: new URLSearchParams(fields),
	});
}

/** The page write guard, then the rsvp handler: the order the root middleware runs them in. */
async function press(req: Request): Promise<unknown> {
	const refused = refuseCrossSitePageWrite(req, ROUTE);
	if (refused) return refused;
	return await (handler as unknown as Record<string, Handler>).POST(context(req));
}

/** Every write door the page's forms can reach, stubbed so a test can count what was pressed. */
function stubDoors() {
	const writes = {
		answer: stub(GuestBackendService, "answer", () => Promise.resolve(ok(null))),
		sendCode: stub(GuestBackendService, "sendCode", () => Promise.resolve(ok(null))),
		optOut: stub(GuestBackendService, "optOut", () => Promise.resolve(ok(null))),
		claim: stub(GuestBackendService, "claim", () => Promise.resolve(ok({ eventId: "evt" }))),
		joinAsGuest: stub(
			RoomBackendService,
			"joinAsGuest",
			() => Promise.resolve(ok({ url: "https://meet.example/room" })),
		),
	};
	const reads = [
		stub(GuestBackendService, "invitation", () => Promise.resolve(ok({ state: "dead" as const }))),
		stub(GuestBackendService, "isMine", () => Promise.resolve(false)),
	];
	return {
		...writes,
		restore: () => [...Object.values(writes), ...reads].forEach((door) => door.restore()),
	};
}

const PRESSES: Record<string, Record<string, string>> = {
	answer: { action: "answer", response: "accepted" },
	code: { action: "code" },
	join: { action: "join", code: "123456" },
	claim: { action: "claim" },
	stop: { action: "stop" },
};
// #endregion

// #region A cross-site form writes nothing
Deno.test("a cross-site form post to /rsvp/:token is a 403 and reaches no door, for every action", async () => {
	const doors = stubDoors();
	try {
		const senders: Record<string, string>[] = [
			{ origin: EVIL },
			{ origin: EVIL, "sec-fetch-site": "same-origin" },
			{ origin: "null", "sec-fetch-site": "cross-site" },
			{ "sec-fetch-site": "same-site" },
			{},
		];
		for (const [action, fields] of Object.entries(PRESSES)) {
			for (const headers of senders) {
				const res = await press(form(headers, fields)) as Response;
				assert(res instanceof Response, `${action} ${JSON.stringify(headers)}`);
				assertEquals(res.status, 403, `${action} ${JSON.stringify(headers)}`);
				assertEquals(res.headers.get("cache-control"), "no-store");
			}
		}
		assertSpyCalls(doors.answer, 0);
		assertSpyCalls(doors.sendCode, 0);
		assertSpyCalls(doors.joinAsGuest, 0);
		assertSpyCalls(doors.claim, 0);
		assertSpyCalls(doors.optOut, 0);
	} finally {
		doors.restore();
	}
});
// #endregion

// #region The page's own forms still work
Deno.test("the page's own form answers, mails a code and joins, through the guard", async () => {
	const doors = stubDoors();
	try {
		const answered = await press(form(OWN_PAGE, PRESSES.answer)) as Response;
		assertEquals(answered.status, 303);
		assertEquals(answered.headers.get("location"), PATH);
		assertSpyCalls(doors.answer, 1);
		assertEquals(doors.answer.calls[0].args, [TOKEN, "accepted"]);

		const coded = await press(form(OWN_PAGE, PRESSES.code)) as Response;
		assertEquals(coded.status, 303);
		assertSpyCalls(doors.sendCode, 1);

		const joined = await press(form(OWN_PAGE, PRESSES.join)) as PageAnswer;
		assertEquals(joined.data.joinUrl, "https://meet.example/room");
		assertSpyCalls(doors.joinAsGuest, 1);
		assertEquals(doors.joinAsGuest.calls[0].args.slice(0, 2), [TOKEN, "123456"]);

		const sameOrigin = await press(form({ origin: BASE }, PRESSES.code)) as Response;
		assertEquals(sameOrigin.status, 303);
		assertSpyCalls(doors.sendCode, 2);
	} finally {
		doors.restore();
	}
});

Deno.test("the page is served no-referrer, so its form's Origin is null and Sec-Fetch-Site decides", async () => {
	const doors = stubDoors();
	try {
		const get = new Request(`${BASE}${PATH}`);
		assertEquals(refuseCrossSitePageWrite(get, ROUTE), null);
		const res = await (handler as unknown as Record<string, Handler>).GET(
			context(get),
		) as PageAnswer;
		assertEquals(res.headers?.["referrer-policy"], "no-referrer");
		assertEquals(res.headers?.["cache-control"], "private, no-store");
		assertEquals(refuseCrossSitePageWrite(form(OWN_PAGE, PRESSES.code), ROUTE), null);
		assertEquals(
			refuseCrossSitePageWrite(form({ origin: "null" }, PRESSES.code), ROUTE)?.status,
			403,
		);
	} finally {
		doors.restore();
	}
});
// #endregion
