import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isSecureRequest, readCookies } from "@web/utils/auth-cookies.ts";
import { ensureSession } from "@web/utils/session.ts";
import { decodeAccessClaims, resolveTokenContext } from "@web/utils/user-context.ts";
import {
	type ContactChoice,
	type ContactEngagementOption,
	type ContactIntent,
	contactSupportTopics,
} from "@projective/types/contact";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import { HelpBackendService } from "@server/services/editorial/HelpBackendService.ts";
import { applyPageMeta, type JsonLdGraph, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import ContactIntake from "../islands/ContactIntake.island.tsx";
import { ContactRail } from "../components/ContactRail.tsx";
import {
	CONTACT_PATH,
	type ContactFormError,
	contactLoginHref,
	parseContactUrl,
} from "../core/contact-url.ts";
import {
	clearReceiptCookie,
	CONTACT_RECEIPT_COOKIE,
	type FormReceipt,
	parseReceiptCookie,
} from "../core/contact-form.ts";
import { contactJsonLd } from "../core/contact-jsonld.ts";
import {
	type ContactPrefill,
	contactPrefillFromClaims,
	NO_PREFILL,
} from "../core/contact-prefill.ts";

/**
 * `/contact` — the page controller (Decision #276); `routes/(public)/contact.tsx` re-exports it.
 *
 * Thin: read the URL contract (`?intent=`, and the no-JS road's `?sent=1` / `?error=`), renew a lapsed
 * session in place (the `[handle]` model — a signed-in reader's engagements are personal), ask the fat
 * {@link ContactBackendService} for a signed-in reader's open engagements and the fat
 * {@link HelpBackendService} for the help centre's categories (the support form's topics — one source,
 * Decision #279; a help centre that cannot be read leaves "Something else", which always sends), pick
 * up a no-JS receipt from its short-lived cookie (and clear it), set the page meta and structured
 * data, and render the header, the `ContactIntake` island and the {@link ContactRail}. Never cached:
 * the page differs per reader.
 */

/**
 * The page's meta description. True of every intent — an anonymous report is read but not answered,
 * so nothing here promises a reply.
 */
const DESCRIPTION =
	"Contact Projective about sales, support, a dispute or a security concern. Every request gets a reference " +
	"number and is read by a person on our team.";

interface ContactPageData {
	intent: ContactIntent;
	signedIn: boolean;
	engagements: ContactEngagementOption[];
	topics: ContactChoice[];
	prefill: ContactPrefill;
	receipt: FormReceipt | null;
	formError: { error: ContactFormError; fields: string[] } | null;
	loginHref: string;
	jsonLd: JsonLdGraph;
}

export const handler = define.handlers({
	async GET(ctx) {
		const session = await ensureSession(ctx.req);
		if (session.authenticated && session.accessToken) {
			ctx.state.accessToken = session.accessToken;
			if (session.refreshed) {
				ctx.state.isAuthenticated = true;
				ctx.state.userContext = resolveTokenContext(session.accessToken);
			}
		}
		const headers: Array<[string, string]> = [
			...[...session.setCookies, ...session.clearCookies].map((
				c,
			): [string, string] => ["set-cookie", c]),
			["cache-control", "private, no-store"],
		];

		const url = parseContactUrl(ctx.url);
		const signedIn = ctx.state.isAuthenticated === true;
		const actor = readActor(ctx);
		const [engagements, help] = await Promise.all([
			signedIn ? ContactBackendService.disputeEngagements(actor) : Promise.resolve([]),
			HelpBackendService.snapshot(),
		]);
		const topics = contactSupportTopics(
			help.ok && help.data ? help.data.library.topics.map((topic) => topic.category) : [],
		);
		const prefill = signedIn
			? contactPrefillFromClaims(decodeAccessClaims(actor.accessToken))
			: { ...NO_PREFILL };

		let receipt: ContactPageData["receipt"] = null;
		if (url.sent) {
			receipt = parseReceiptCookie(readCookies(ctx.req)[CONTACT_RECEIPT_COOKIE]);
			headers.push(["set-cookie", clearReceiptCookie(isSecureRequest(ctx.req))]);
		}

		const origin = siteOrigin(ctx.url);
		applyPageMeta(
			ctx.state,
			pageMeta({ title: "Contact", description: DESCRIPTION, path: CONTACT_PATH, origin }),
		);

		return page<ContactPageData>({
			intent: receipt?.intent ?? url.intent,
			signedIn,
			engagements,
			topics,
			prefill,
			receipt,
			formError: url.error ? { error: url.error, fields: url.fields } : null,
			loginHref: contactLoginHref("dispute"),
			jsonLd: contactJsonLd(origin, DESCRIPTION),
		}, { headers });
	},
});

export default define.page<typeof handler>(function ContactPage({ data }) {
	return (
		<div class="ctc">
			<header class="ctc__head">
				<p class="ctc__eyebrow">Contact</p>
				<h1 class="ctc__title">How can we help?</h1>
				<p class="ctc__lede">
					Choose what it's about and tell us what you need. Every request gets a reference number
					and is read by a person on our team.
				</p>
			</header>
			<div class="ctc__canvas">
				<ContactIntake
					intent={data.intent}
					signedIn={data.signedIn}
					engagements={data.engagements}
					topics={data.topics}
					prefill={data.prefill}
					loginHref={data.loginHref}
					receipt={data.receipt}
					formError={data.formError}
				/>
				<ContactRail />
			</div>
			<JsonLd graph={data.jsonLd} />
		</div>
	);
});
