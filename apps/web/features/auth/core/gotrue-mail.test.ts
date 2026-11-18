import { assert, assertEquals, assertFalse } from "@std/assert";
import { parse } from "@std/toml";
import { RESEND_COOLDOWN_S } from "./resend-cooldown.ts";

const ROOT = new URL("../../../../../", import.meta.url);
const SUPABASE = new URL("supabase/", ROOT);

type Section = "template" | "notification";
type Reach = "app" | "api" | "ahead" | "unreachable";

interface GoTrueEmail {
	section: Section;
	reach: Reach;
	why: string;
	vars: readonly string[];
}

interface MailEntry {
	enabled?: boolean;
	subject?: string;
	content_path?: string;
}

const LINKED = ["ConfirmationURL", "Data", "Email", "RedirectTo", "SiteURL", "Token", "TokenHash"];
const NOTICE = ["Data", "Email", "SiteURL"];

// #region Inventory (GoTrue v2.197.0 templatemailer data maps)
const GOTRUE_EMAILS: Record<string, GoTrueEmail> = {
	confirmation: {
		section: "template",
		reach: "app",
		why: "sign-up and /verify's Resend (AuthBackendService.dispatchConfirmation)",
		vars: LINKED,
	},
	recovery: {
		section: "template",
		reach: "app",
		why: "/forgot-password and Settings → Password (AuthBackendService.requestPasswordReset)",
		vars: LINKED,
	},
	reauthentication: {
		section: "template",
		reach: "api",
		why:
			"GET /auth/v1/reauthenticate, which secure_password_change asks for on a session over 24 hours old; the app's resets mint a fresh session",
		vars: ["Data", "Email", "SiteURL", "Token"],
	},
	magic_link: {
		section: "template",
		reach: "api",
		why:
			"POST /auth/v1/otp for a confirmed address: GoTrue has no switch for it and the app never calls it",
		vars: LINKED,
	},
	email_change: {
		section: "template",
		reach: "api",
		why: "PUT /auth/v1/user with the owner's own token; the app has no change door (ID-37)",
		vars: [...LINKED, "NewEmail", "SendingTo"],
	},
	invite: {
		section: "template",
		reach: "unreachable",
		why: "needs the service role, and nothing calls inviteUserByEmail",
		vars: LINKED,
	},
	password_changed: {
		section: "notification",
		reach: "app",
		why: "every recovery reset ends in updateUser({ password })",
		vars: NOTICE,
	},
	identity_linked: {
		section: "notification",
		reach: "app",
		why: "Settings → Connected accounts links a provider (linkIdentity)",
		vars: [...NOTICE, "Provider"],
	},
	identity_unlinked: {
		section: "notification",
		reach: "app",
		why: "Settings → Connected accounts unlinks a provider",
		vars: [...NOTICE, "Provider"],
	},
	mfa_factor_enrolled: {
		section: "notification",
		reach: "ahead",
		why: "MFA1 switches [auth.mfa.totp] enrolment on",
		vars: [...NOTICE, "FactorType"],
	},
	mfa_factor_unenrolled: {
		section: "notification",
		reach: "ahead",
		why: "MFA1 switches [auth.mfa.totp] enrolment on",
		vars: [...NOTICE, "FactorType"],
	},
	email_changed: {
		section: "notification",
		reach: "unreachable",
		why: "follows a completed email change, which email_change.html never confirms",
		vars: [...NOTICE, "OldEmail"],
	},
	phone_changed: {
		section: "notification",
		reach: "unreachable",
		why: "[auth.sms] is off and nothing signs in by phone",
		vars: [...NOTICE, "Phone", "OldPhone"],
	},
};
// #endregion

const config = parse(await Deno.readTextFile(new URL("config.toml", SUPABASE))) as {
	auth: {
		email: {
			max_frequency: string;
			smtp: { enabled: boolean; pass: string; admin_email: string; host: string };
			template: Record<string, MailEntry>;
			notification: Record<string, MailEntry>;
		};
	};
};
const email = config.auth.email;

function wired(type: string, section: Section): MailEntry | undefined {
	return (section === "template" ? email.template : email.notification)[type];
}

function contentUrl(section: Section, path: string): URL {
	return new URL(path, section === "template" ? ROOT : SUPABASE);
}

const wiredTypes = Object.entries(GOTRUE_EMAILS).filter(([, e]) => e.reach !== "unreachable");
const bodies = new Map<string, string>(
	await Promise.all(
		wiredTypes.map(async ([type, e]) => {
			const path = wired(type, e.section)?.content_path ?? "";
			return [type, await Deno.readTextFile(contentUrl(e.section, path))] as const;
		}),
	),
);

Deno.test("only inventoried GoTrue email types are wired", () => {
	for (const type of Object.keys(email.template)) {
		assertEquals(GOTRUE_EMAILS[type]?.section, "template", `unknown template ${type}`);
	}
	for (const type of Object.keys(email.notification)) {
		assertEquals(GOTRUE_EMAILS[type]?.section, "notification", `unknown notification ${type}`);
	}
});

Deno.test("every reachable type is wired with a subject and a template that exists", async () => {
	for (const [type, e] of wiredTypes) {
		const entry = wired(type, e.section);
		assert(entry, `${type} (${e.why}) is not wired`);
		assert(entry.subject?.trim(), `${type} has no subject`);
		assert(entry.content_path, `${type} has no content_path`);
		const stat = await Deno.stat(contentUrl(e.section, entry.content_path));
		assert(stat.isFile, `${type}: ${entry.content_path} is missing`);
		if (e.section === "notification") assertEquals(entry.enabled, true, `${type} is not enabled`);
	}
});

Deno.test("an unreachable type stays unwired, so wiring one updates this inventory", () => {
	for (const [type, e] of Object.entries(GOTRUE_EMAILS)) {
		if (e.reach === "unreachable") assertEquals(wired(type, e.section), undefined, type);
	}
});

Deno.test("no template URL carries the address or other personal data", () => {
	const PII = /\{\{-?\s*\.(Email|NewEmail|OldEmail|SendingTo|Phone|OldPhone|Data)\b/;
	for (const [type, html] of bodies) {
		const urls = [
			...[...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]),
			...[...html.matchAll(/\{\{\s*\.(?:RedirectTo|SiteURL)\s*\}\}[^\s"<]*/g)].map((m) => m[0]),
		];
		assert(urls.length > 0, `${type} has no URL`);
		for (const url of urls) {
			assertFalse(PII.test(url), `${type}: ${url}`);
			assertFalse(/[?&](amp;)?email=/i.test(url), `${type}: ${url}`);
			assertFalse(/\{\{\s*\.Token\s*\}\}/.test(url), `${type}: a one-time code in ${url}`);
		}
	}
});

Deno.test("each template uses only the variables GoTrue passes its type", () => {
	for (const [type, html] of bodies) {
		const allowed = new Set(GOTRUE_EMAILS[type].vars);
		for (const action of html.matchAll(/\{\{(.*?)\}\}/g)) {
			for (const field of action[1].matchAll(/\.([A-Za-z]+)/g)) {
				assert(allowed.has(field[1]), `${type} uses {{ .${field[1]} }}, which GoTrue never sets`);
			}
		}
	}
});

Deno.test("magic_link and email_change carry no link or code a caller could spend", () => {
	for (const type of ["magic_link", "email_change"]) {
		assertFalse(/\.(Token|TokenHash|ConfirmationURL)\b/.test(bodies.get(type) ?? ""), type);
	}
});

Deno.test("every template shares the shell and footer of the originals", () => {
	const head = (html: string) => {
		const lf = html.replace(/\r\n/g, "\n");
		return lf.slice(0, lf.indexOf("</head>")).replace(/<title>.*<\/title>/, "");
	};
	const reference = head(bodies.get("recovery") ?? "");
	for (const [type, html] of bodies) {
		assertEquals(head(html), reference, `${type}'s <head> drifted from recovery.html`);
		assert(
			/src="\{\{ \.(RedirectTo|SiteURL) \}\}\/email\/logo-mark\.png"/.test(html),
			`${type} logo`,
		);
		assert(
			html.includes("&copy; Projective &middot; Build Together. Deliver Better."),
			`${type} footer`,
		);
	}
});

Deno.test("GoTrue's send interval equals the app's resend cooldown", () => {
	const match = /^(\d+)(s|m|h)$/.exec(email.max_frequency);
	assert(match, `unparsed max_frequency ${email.max_frequency}`);
	const seconds = Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2] as "s" | "m" | "h"];
	assertEquals(seconds, RESEND_COOLDOWN_S);
});

Deno.test("local SMTP stays off so mail lands in Mailpit, and its secrets come from the environment", () => {
	assertEquals(email.smtp.enabled, false);
	assertEquals(email.smtp.pass, "env(SUPABASE_AUTH_SMTP_PASS)");
	assert(email.smtp.admin_email.startsWith("env("), "admin_email must come from the environment");
});
