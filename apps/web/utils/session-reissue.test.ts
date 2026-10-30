import { assert, assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { HttpError } from "fresh";
import type { UserContext } from "@projective/types/auth";
import type { AccountLifecycle } from "@projective/types/org";
import { fail, ok, type ServiceResult } from "@server/services/ServiceResult.ts";
import { AuthBackendService, type AuthPayload } from "@server/services/auth/AuthBackendService.ts";
import { ContextBackendService } from "@server/services/context/ContextBackendService.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";
import { SettingsBackendService } from "@server/services/user/SettingsBackendService.ts";
import {
	AccountLifecycleBackendService,
	type HandleChanged,
} from "@server/services/user/AccountLifecycleBackendService.ts";
import { handler as refreshRoute } from "../routes/api/auth/refresh.ts";
import { handler as switchRoute } from "../routes/api/context/switch.ts";
import { handler as freelancerRoute } from "../routes/api/user/freelancer.ts";
import { handler as preferencesRoute } from "../routes/api/user/preferences.ts";
import { handler as handleRoute } from "../routes/api/user/handle.ts";
import { handler as lifecycleRoute } from "../routes/api/user/lifecycle.ts";
import dashboardGuard from "../routes/(dashboard)/_middleware.ts";
import { ensureSession } from "./session.ts";
import type { State } from "./state.ts";

/**
 * session-reissue_test — what happens to the browser's session cookies when a refresh fails, and how
 * the two claim-changing mutations (a context switch, a freelancer unlock) re-issue the session
 * themselves. GoTrue is replaced by stubbing {@link AuthBackendService.refreshSession}, which is the
 * seam every caller renews through.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const OLD_COOKIES = "sb-access-token=old-access; sb-refresh-token=old-refresh";

const RENEWED: ServiceResult<AuthPayload> = ok({}, {
	session: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 },
});
const REJECTED: ServiceResult<AuthPayload> = fail(401, { message: "Your session has expired." });
const UNAVAILABLE: ServiceResult<AuthPayload> = fail(503, { message: "Try again in a moment." });

async function call(
	handlers: unknown,
	path: string,
	body?: unknown,
	state: State = { userContext: ALICE },
	method = "POST",
): Promise<{ status: number; body: Record<string, unknown> | null; cookies: string[] }> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, {
		method,
		headers: { cookie: OLD_COOKIES },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const fn = (handlers as Record<string, Handler>)[method];
	const res = await fn({
		req,
		url,
		params: {},
		state,
		info: { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } },
	});
	const text = await res.text();
	return {
		status: res.status,
		body: text ? JSON.parse(text) : null,
		cookies: res.headers.getSetCookie(),
	};
}

function withRefresh<T>(
	result: ServiceResult<AuthPayload>,
	run: (calls: () => number) => Promise<T>,
): Promise<T> {
	const refresh = stub(AuthBackendService, "refreshSession", () => Promise.resolve(result));
	return run(() => refresh.calls.length).finally(() => refresh.restore());
}

function clears(cookies: string[]): boolean {
	return cookies.length === 2 && cookies.every((c) => c.includes("Max-Age=0"));
}
// #endregion

// #region POST /api/auth/refresh
Deno.test("refresh: a refused grant clears both session cookies and answers 401", async () => {
	await withRefresh(REJECTED, async () => {
		const { status, cookies } = await call(refreshRoute, "/api/auth/refresh");
		assertEquals(status, 401);
		assert(clears(cookies), cookies.join(" | "));
	});
});

Deno.test("refresh: an unreachable or failing GoTrue keeps the cookies and answers 503", async () => {
	await withRefresh(UNAVAILABLE, async () => {
		const { status, body, cookies } = await call(refreshRoute, "/api/auth/refresh");
		assertEquals(status, 503);
		assertEquals(body?.ok, false);
		assertEquals(cookies, []);
	});
});

Deno.test("refresh: a renewed session mints the rotated cookies", async () => {
	await withRefresh(RENEWED, async () => {
		const { status, cookies } = await call(refreshRoute, "/api/auth/refresh");
		assertEquals(status, 200);
		assert(cookies.some((c) => c.startsWith("sb-refresh-token=new-refresh;")));
	});
});
// #endregion

// #region Claim-changing mutations
const UNLOCKED = {
	freelancerProfileId: "6f1c1a52-1d7e-4b8a-9f43-2a1f0c9d5e11",
	handle: "alice",
	created: true,
	isFreelancer: true as const,
};

const MUTATIONS = [
	{
		name: "context switch",
		handlers: switchRoute,
		path: "/api/context/switch",
		body: { contextType: "personal", contextId: null },
		stubService: () =>
			stub(
				ContextBackendService,
				"switchContext",
				() => Promise.resolve(ok({}, { message: "Switched." })),
			),
	},
	{
		name: "freelancer unlock",
		handlers: freelancerRoute,
		path: "/api/user/freelancer",
		body: { skills: ["web-design"] },
		stubService: () =>
			stub(
				UserBackendService,
				"enableFreelancer",
				() => Promise.resolve(ok(UNLOCKED, { status: 201 })),
			),
	},
];

for (const mutation of MUTATIONS) {
	Deno.test(`${mutation.name}: success re-issues the session server-side`, async () => {
		const service = mutation.stubService();
		try {
			await withRefresh(RENEWED, async (refreshes) => {
				const { status, body, cookies } = await call(
					mutation.handlers,
					mutation.path,
					mutation.body,
				);
				assert(status === 200 || status === 201, String(status));
				assertEquals(body?.ok, true);
				assertEquals(body?.claimsStale, false);
				assertEquals(refreshes(), 1);
				assert(cookies.some((c) => c.startsWith("sb-access-token=new-access;")));
				assert(cookies.some((c) => c.startsWith("sb-refresh-token=new-refresh;")));
			});
		} finally {
			service.restore();
		}
	});

	for (
		const [label, outcome] of [["a refused", REJECTED], ["an unavailable", UNAVAILABLE]] as const
	) {
		Deno.test(`${mutation.name}: ${label} re-issue keeps the old cookies and flags claimsStale`, async () => {
			const service = mutation.stubService();
			try {
				await withRefresh(outcome, async () => {
					const { body, cookies } = await call(mutation.handlers, mutation.path, mutation.body);
					assertEquals(body?.ok, true);
					assertEquals(body?.claimsStale, true);
					assertEquals(cookies, []);
				});
			} finally {
				service.restore();
			}
		});
	}
}

Deno.test("context switch: a refused switch never touches the session", async () => {
	const service = stub(
		ContextBackendService,
		"switchContext",
		() => Promise.resolve(fail(403, { message: "Not a member." })),
	);
	try {
		await withRefresh(RENEWED, async (refreshes) => {
			const { status, body, cookies } = await call(switchRoute, "/api/context/switch", {
				contextType: "personal",
				contextId: null,
			});
			assertEquals(status, 403);
			assertEquals(body?.claimsStale, undefined);
			assertEquals(refreshes(), 0);
			assertEquals(cookies, []);
		});
	} finally {
		service.restore();
	}
});
// #endregion

// #region ensureSession (the page guards)
function expiredAccess(): Request {
	return new Request("https://app.example.test/projects", {
		headers: { cookie: "sb-refresh-token=old-refresh" },
	});
}

Deno.test("ensureSession: a refused grant clears the dead session", async () => {
	await withRefresh(REJECTED, async () => {
		const session = await ensureSession(expiredAccess());
		assertEquals(session.authenticated, false);
		assertEquals(session.unavailable, false);
		assert(clears(session.clearCookies));
	});
});

Deno.test("ensureSession: an unavailable GoTrue keeps the cookies for the next request", async () => {
	await withRefresh(UNAVAILABLE, async () => {
		const session = await ensureSession(expiredAccess());
		assertEquals(session.authenticated, false);
		assertEquals(session.unavailable, true);
		assertEquals(session.clearCookies, []);
	});
});

async function guard(): Promise<Response> {
	const req = expiredAccess();
	const next = () => Promise.resolve(new Response("page"));
	return await (dashboardGuard as Handler)({ req, url: new URL(req.url), state: {}, next });
}

Deno.test("dashboard guard: a dead session bounces to sign-in and clears the cookies", async () => {
	await withRefresh(REJECTED, async () => {
		const res = await guard();
		assertEquals(res.status, 302);
		assert(res.headers.get("location")?.includes("/login?redirectTo="));
		assert(clears(res.headers.getSetCookie()));
	});
});

Deno.test("dashboard guard: an outage answers 503 in place instead of sending anyone to sign-in", async () => {
	await withRefresh(UNAVAILABLE, async () => {
		const error = await assertRejects(() => guard(), HttpError);
		assertEquals(error.status, 503);
	});
});
// #endregion

// #region Settings writes that change claims
const PREFERENCES_SAVED = { preferences: null, appearance: null, appearancePersisted: false };

const HANDLE_CHANGED: HandleChanged = {
	policy: {
		handle: "alice_new",
		remaining: 1,
		windowEndsAt: null,
		lockedUntil: null,
		lastChangedAt: null,
		totalChanges: 1,
	},
	previous: "alice",
};

const LIFECYCLE: { lifecycle: AccountLifecycle } = {
	lifecycle: {
		isFreelancer: true,
		hasFreelancerProfile: true,
		freelancerRemoval: null,
		accountDeletion: null,
		freelancerBlockers: [],
		accountBlockers: [],
	},
};

Deno.test("preferences: a claim-bearing field re-issues the session", async () => {
	for (const patch of [{ locale: "fr-FR" }, { preferredDisplayCurrency: "EUR" }, { dateFormat: null }]) {
		const service = stub(
			SettingsBackendService,
			"updatePreferences",
			() => Promise.resolve(ok(PREFERENCES_SAVED)),
		);
		try {
			await withRefresh(RENEWED, async (refreshes) => {
				const res = await call(preferencesRoute, "/api/user/preferences", patch, undefined, "PATCH");
				assertEquals(res.body?.claimsStale, false, JSON.stringify(patch));
				assertEquals(refreshes(), 1);
				assert(res.cookies.some((c) => c.startsWith("sb-access-token=new-access;")));
			});
		} finally {
			service.restore();
		}
	}
});

Deno.test("preferences: a field the token does not carry leaves the session alone", async () => {
	const service = stub(
		SettingsBackendService,
		"updatePreferences",
		() => Promise.resolve(ok(PREFERENCES_SAVED)),
	);
	try {
		await withRefresh(RENEWED, async (refreshes) => {
			const res = await call(
				preferencesRoute,
				"/api/user/preferences",
				{ layoutDirection: "rtl" },
				undefined,
				"PATCH",
			);
			assertEquals(res.body?.ok, true);
			assertEquals(res.body?.claimsStale, undefined);
			assertEquals(refreshes(), 0);
		});
	} finally {
		service.restore();
	}
});

Deno.test("handle: a changed handle re-issues the session, or flags it stale", async () => {
	const service = stub(
		AccountLifecycleBackendService,
		"changeHandle",
		() => Promise.resolve(ok(HANDLE_CHANGED)),
	);
	try {
		for (const [outcome, stale] of [[RENEWED, false], [UNAVAILABLE, true]] as const) {
			await withRefresh(outcome, async (refreshes) => {
				const res = await call(handleRoute, "/api/user/handle", { handle: "alice_new" });
				assertEquals(res.body?.ok, true);
				assertEquals(res.body?.claimsStale, stale);
				assertEquals(refreshes(), 1);
			});
		}
	} finally {
		service.restore();
	}
});

Deno.test("lifecycle: only a freelancer-profile change re-issues the session", async () => {
	const schedule = stub(
		AccountLifecycleBackendService,
		"schedule",
		() => Promise.resolve(ok(LIFECYCLE)),
	);
	const cancel = stub(AccountLifecycleBackendService, "cancel", () => Promise.resolve(ok(LIFECYCLE)));
	try {
		await withRefresh(RENEWED, async (refreshes) => {
			const removed = await call(lifecycleRoute, "/api/user/lifecycle", {
				scope: "freelancer_profile",
				confirmation: "CONFIRM",
			});
			assertEquals(removed.body?.claimsStale, false);
			const restored = await call(
				lifecycleRoute,
				"/api/user/lifecycle?scope=freelancer_profile",
				undefined,
				undefined,
				"DELETE",
			);
			assertEquals(restored.body?.claimsStale, false);
			assertEquals(refreshes(), 2);

			const account = await call(lifecycleRoute, "/api/user/lifecycle", {
				scope: "account",
				confirmation: "CONFIRM",
			});
			assertEquals(account.body?.claimsStale, undefined);
			assertEquals(refreshes(), 2);
		});
	} finally {
		schedule.restore();
		cancel.restore();
	}
});
// #endregion
