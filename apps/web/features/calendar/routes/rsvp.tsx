import { page } from "fresh";
import type { Context } from "fresh";
import { GuestAnswer, type LiveGuestInvitation } from "@projective/types/scheduling";
import {
	GuestBackendService,
	guestDeviceKey,
	guestPressAllowed,
	parseGuestCode,
} from "@server/services/scheduling/GuestBackendService.ts";
import { RoomBackendService } from "@server/services/integrations/RoomBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { define, type State } from "@web/utils/state.ts";
import RsvpGate from "../islands/RsvpGate.island.tsx";

/**
 * `/rsvp/[token]` — where a guest's email lands: an invitation for somebody with no account, on a page
 * with no shell (Decision #391). Thin controller: the link is the only authority, and the fat
 * {@link GuestBackendService} and its doors decide what it may do.
 *
 * **A GET changes nothing and sends nothing**, because mail scanners follow every link in a message
 * before a person ever sees it. Each act is a POST from a plain form, so the page needs no JavaScript.
 *
 * **A good code ends on a page, not a redirect.** The platform CSP's `form-action 'self'` also binds
 * where a form's redirect may go, so a `303` to a provider would be blocked after a correct code. The
 * page renders the link instead, and following it is the guest's own press.
 *
 * `noindex`, `no-referrer` and `no-store`, because the path is a capability.
 */

const HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"x-robots-tag": "noindex, nofollow",
	"referrer-policy": "no-referrer",
	"cache-control": "private, no-store",
});

/** What the page says beyond the invitation itself. */
interface Outcome {
	refusal?: string | null;
	notice?: string | null;
	joinUrl?: string | null;
}

type Ctx = Context<State>;

/** Draw the page for this link, with what the last press came to. */
async function show(ctx: Ctx, outcome: Outcome, status?: number) {
	const { token } = ctx.params;
	const res = await GuestBackendService.invitation(token);
	const view = res.ok ? res.data ?? null : null;
	ctx.state.title = "Your invitation · Projective";
	const live = view?.state === "live" ? view as LiveGuestInvitation : null;
	return page({
		token,
		invitation: live,
		failed: !res.ok,
		signedIn: ctx.state.isAuthenticated === true,
		canClaim: live ? await GuestBackendService.isMine(token, readActor(ctx)) : false,
		...outcome,
	}, { status: status ?? (res.ok ? (live ? 200 : 404) : 503), headers: HEADERS });
}

/** Back to the invitation, so a reload does not press again. */
function again(ctx: Ctx): Response {
	return new Response(null, { status: 303, headers: { location: ctx.url.pathname, ...HEADERS } });
}

export const handler = define.handlers({
	GET(ctx) {
		return show(ctx, {});
	},

	async POST(ctx) {
		const { token } = ctx.params;
		const client = clientKey(ctx.info.remoteAddr, ctx.req.headers);
		if (!guestPressAllowed(client)) {
			return show(
				ctx,
				{ refusal: "That's a lot of tries. Wait a minute, then try again." },
				429,
			);
		}
		const form = await ctx.req.formData().catch(() => null);
		const action = form?.get("action");

		if (action === "answer") {
			const answer = GuestAnswer.safeParse(form?.get("response"));
			if (!answer.success) return again(ctx);
			const res = await GuestBackendService.answer(token, answer.data);
			return res.ok ? again(ctx) : show(ctx, { refusal: res.message }, res.status);
		}
		if (action === "code") {
			const res = await GuestBackendService.sendCode(token);
			return res.ok ? again(ctx) : show(ctx, { refusal: res.message }, res.status);
		}
		if (action === "join") {
			const code = parseGuestCode(form?.get("code"));
			if (!code) {
				return show(ctx, { refusal: "Enter the 6-digit code from your email." }, 422);
			}
			const device = await guestDeviceKey(
				token,
				client,
				ctx.req.headers.get("user-agent") ?? "",
			);
			const res = await RoomBackendService.joinAsGuest(token, code, device);
			return res.ok && res.data
				? show(ctx, { joinUrl: res.data.url })
				: show(ctx, { refusal: res.message }, res.status);
		}
		if (action === "claim") {
			const res = await GuestBackendService.claim(token, readActor(ctx));
			if (!res.ok || !res.data) return show(ctx, { refusal: res.message }, res.status);
			const location = `/calendar?filter=invitations&event=${res.data.eventId}`;
			return new Response(null, { status: 303, headers: { location, ...HEADERS } });
		}
		if (action === "stop") {
			const res = await GuestBackendService.optOut(token);
			return res.ok
				? show(ctx, { notice: "Done. You won't get any more invitations at this address." })
				: show(ctx, { refusal: res.message }, res.status);
		}
		return again(ctx);
	},
});

export default define.page<typeof handler>(function RsvpPage({ data }) {
	return <RsvpGate {...data} />;
});
