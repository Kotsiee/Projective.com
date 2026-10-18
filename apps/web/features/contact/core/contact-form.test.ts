/** The no-JS road through `POST /api/contact` (Decision #276): body, origin, outcome, receipt cookie. */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ContactSubmissionSchema } from "@projective/types/contact";
import {
	clearReceiptCookie,
	CONTACT_RECEIPT_COOKIE,
	formFailureHref,
	formIntent,
	formSuccessHref,
	isCrossSitePost,
	isFormPost,
	parseReceiptCookie,
	receiptCookie,
	submissionFromForm,
} from "./contact-form.ts";

const post = (headers: Record<string, string>) =>
	new Request("https://projective.app/api/contact", { method: "POST", headers });

Deno.test("submissionFromForm: the form's fields as the schema's submission", () => {
	const form = new URLSearchParams({
		intent: "security",
		reportType: "abuse",
		anonymous: "on",
		message: "Somebody is running a fake account under our name.",
		ctc_hp: "",
		unknown: "ignored",
	});
	const body = submissionFromForm(form);
	assertEquals(body.anonymous, true);
	assertFalse("unknown" in body);
	assert(ContactSubmissionSchema.safeParse(body).success);
	const support = submissionFromForm(
		new URLSearchParams([
			["intent", "support"],
			["attachmentIds", "00000000-0000-4000-8000-0000000000a1"],
			["attachmentIds", ""],
		]),
	);
	assertEquals(support.attachmentIds, ["00000000-0000-4000-8000-0000000000a1"]);
	assertEquals(
		(submissionFromForm(new URLSearchParams({ message: "x".repeat(9000) })).message as string)
			.length,
		6000,
	);
});

Deno.test("submissionFromForm: an anonymous report drops the hidden name and email it still posts", () => {
	const fields = {
		intent: "security",
		reportType: "whistleblower",
		message: "A business on the platform is invoicing for work nobody delivered.",
		name: "Typed before ticking",
		email: "not-an-address",
	};
	const anonymous = submissionFromForm(new URLSearchParams({ ...fields, anonymous: "on" }));
	assertFalse("name" in anonymous);
	assertFalse("email" in anonymous);
	assert(
		ContactSubmissionSchema.safeParse(anonymous).success,
		"never refused over a field it hid",
	);
	const named = submissionFromForm(new URLSearchParams(fields));
	assertEquals(named.name, "Typed before ticking");
	assertFalse(
		ContactSubmissionSchema.safeParse(named).success,
		"a named report's address is still checked",
	);
});

Deno.test("isFormPost: urlencoded and multipart, never JSON", () => {
	assert(isFormPost(post({ "content-type": "application/x-www-form-urlencoded; charset=UTF-8" })));
	assert(isFormPost(post({ "content-type": "multipart/form-data; boundary=x" })));
	assertFalse(isFormPost(post({ "content-type": "application/json" })));
	assertFalse(isFormPost(post({})));
});

Deno.test("isCrossSitePost: another origin, an opaque origin, or a cross-site fetch is refused", () => {
	assertFalse(isCrossSitePost(post({ origin: "https://projective.app" })));
	assert(isCrossSitePost(post({ origin: "https://evil.example" })));
	assert(isCrossSitePost(post({ origin: "null" })));
	assertFalse(isCrossSitePost(post({ "sec-fetch-site": "same-origin" })));
	assert(isCrossSitePost(post({ "sec-fetch-site": "cross-site" })));
	assertFalse(isCrossSitePost(post({})), "an old browser's plain form is allowed");
});

Deno.test("outcome hrefs: the service's status picks the refusal kind", () => {
	assertEquals(formSuccessHref("sales"), "/contact?intent=sales&sent=1");
	assertEquals(
		formFailureHref("support", 422, { email: "x" }),
		"/contact?intent=support&error=invalid&fields=email",
	);
	assertEquals(
		formFailureHref("support", 429, undefined),
		"/contact?intent=support&error=rate_limited",
	);
	assertEquals(formFailureHref("dispute", 401, undefined), "/contact?intent=dispute&error=sign_in");
	assertEquals(
		formFailureHref("security", 503, undefined),
		"/contact?intent=security&error=unavailable",
	);
	assertEquals(formIntent({ intent: "sales" }), "sales");
	assertEquals(formIntent({ intent: 42 }), "support");
});

Deno.test("receipt cookie: HttpOnly, scoped to /contact, short-lived; read back strictly", () => {
	const set = receiptCookie({
		reference: "CT-7K4Q-2M9X",
		intent: "dispute",
		status: "backlog",
		receivedAt: "x",
	}, true);
	assert(set.startsWith(`${CONTACT_RECEIPT_COOKIE}=CT-7K4Q-2M9X.dispute;`));
	assert(set.includes("Path=/contact") && set.includes("HttpOnly") && set.includes("SameSite=Lax"));
	assert(set.includes("Max-Age=600") && set.endsWith("Secure"));
	assertFalse(
		receiptCookie({
			reference: "CT-7K4Q-2M9X",
			intent: "sales",
			status: "backlog",
			receivedAt: "x",
		}, false).includes("Secure"),
	);
	assert(clearReceiptCookie(false).includes("Max-Age=0"));
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.dispute"), {
		reference: "CT-7K4Q-2M9X",
		intent: "dispute",
		anonymous: false,
	});
	const anonymous = receiptCookie(
		{
			reference: "CT-7K4Q-2M9X",
			intent: "security",
			status: "backlog",
			receivedAt: "x",
		},
		false,
		true,
	);
	assert(anonymous.startsWith(`${CONTACT_RECEIPT_COOKIE}=CT-7K4Q-2M9X.security.anonymous;`));
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.security.anonymous"), {
		reference: "CT-7K4Q-2M9X",
		intent: "security",
		anonymous: true,
	});
	assertFalse(
		receiptCookie(
			{ reference: "CT-7K4Q-2M9X", intent: "sales", status: "backlog", receivedAt: "x" },
			false,
			true,
		)
			.includes("anonymous"),
		"only a security report is ever anonymous",
	);
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.sales.anonymous"), null);
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.security.other"), null);
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.security.anonymous.x"), null);
	assertEquals(parseReceiptCookie("CT-7K4Q-2M9X.press"), null);
	assertEquals(parseReceiptCookie("<script>.sales"), null);
	assertEquals(parseReceiptCookie(""), null);
	assertEquals(parseReceiptCookie(undefined), null);
});
