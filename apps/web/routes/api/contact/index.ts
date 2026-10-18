import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isSecureRequest } from "@web/utils/auth-cookies.ts";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import {
	clientKey,
	toContactResponse,
	unreadableBody,
} from "@features/contact/core/contact-respond.ts";
import {
	formFailureHref,
	formIntent,
	formSuccessHref,
	isAnonymousFormBody,
	isCrossSitePost,
	isFormPost,
	receiptCookie,
	submissionFromForm,
} from "@features/contact/core/contact-form.ts";

/**
 * `POST /api/contact` — the `/contact` intake (Decision #276). Thin route, two roads:
 *
 *  - **JSON** (the `ContactIntake` island): the body goes to the fat {@link ContactBackendService}
 *    and its result comes back as the contact envelope (`toContactResponse`): 201 with the receipt,
 *    or 422 / 401 / 429 / 503 with field errors and a sentence.
 *  - **A form post** (no JavaScript): the body is read field by field (`submissionFromForm`), a
 *    cross-site post is refused outright, and the answer is a 303 back to `/contact` — `?sent=1`
 *    with the receipt in a short-lived HttpOnly cookie, or `?error=` naming the fields to mark.
 *
 * Anyone may post: a guest's request is written as `anon`, a signed-in sender's under their own
 * session (the service decides which; the writer stamps the account). Never cached.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		const meta = { clientKey: clientKey(ctx.info.remoteAddr) };

		if (isFormPost(ctx.req)) {
			const form = await ctx.req.formData().catch(() => null);
			const body = form ? submissionFromForm(form) : {};
			const intent = formIntent(body);
			if (!form || isCrossSitePost(ctx.req)) {
				return new Response(null, {
					status: 303,
					headers: {
						location: formFailureHref(intent, 503, undefined),
						"cache-control": "no-store",
					},
				});
			}
			const result = await ContactBackendService.submit(body, actor, meta);
			const headers = new Headers({ "cache-control": "no-store" });
			if (result.ok && result.data) {
				headers.set("location", formSuccessHref(result.data.intent));
				headers.append(
					"set-cookie",
					receiptCookie(result.data, isSecureRequest(ctx.req), isAnonymousFormBody(body)),
				);
			} else {
				headers.set("location", formFailureHref(intent, result.status, result.errors));
			}
			return new Response(null, { status: 303, headers });
		}

		const raw = await ctx.req.json().catch(() => undefined);
		if (raw === undefined) return unreadableBody();
		return toContactResponse(await ContactBackendService.submit(raw, actor, meta));
	},
});
