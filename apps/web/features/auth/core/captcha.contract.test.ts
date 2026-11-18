/**
 * While `supabase/config.toml` turns GoTrue's CAPTCHA on, every GoTrue call it gates must carry the
 * Turnstile token, or sign-in, recovery and resend are refused for everyone (providers spec §9.1,
 * Decision #447). `/join` creates its account with the service role, which GoTrue's check skips, so
 * its route must verify the token itself. Source-level: the live path needs a running stack.
 */
import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { EnterpriseJoinSchema, IndividualJoinSchema } from "@projective/types/auth";
import { ForgotPasswordSchema, LoginSchema, ResendSchema } from "./schema.ts";

const ROOT = new URL("../../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

interface CaptchaConfig {
	enabled?: boolean;
	provider?: string;
	secret?: string;
}

const config = parse(read("supabase/config.toml")) as { auth?: { captcha?: CaptchaConfig } };
const captcha = config.auth?.captcha ?? {};
const SERVICE = read("packages/backend/services/auth/AuthBackendService.ts");

/** GoTrue client methods whose endpoints run GoTrue's `verifyCaptcha`. */
const GATED = ["signUp", "signInWithPassword", "resetPasswordForEmail", "resend", "signInWithOtp"];

/** The argument text of every `.auth.<method>(…)` call in `source`. */
function callArguments(source: string, method: string): string[] {
	const out: string[] = [];
	const pattern = new RegExp(`\\.auth\\.${method}\\(`, "g");
	for (const match of source.matchAll(pattern)) {
		let depth = 1;
		let i = (match.index ?? 0) + match[0].length;
		const start = i;
		for (; i < source.length && depth > 0; i++) {
			if (source[i] === "(") depth++;
			else if (source[i] === ")") depth--;
		}
		out.push(source.slice(start, i - 1));
	}
	return out;
}

Deno.test("config.toml: GoTrue's CAPTCHA is Turnstile, with its secret from the environment", () => {
	if (!captcha.enabled) return;
	assertEquals(captcha.provider, "turnstile");
	assertEquals(captcha.secret, "env(SUPABASE_AUTH_CAPTCHA_SECRET)", "never a literal secret");
});

Deno.test("every CAPTCHA-gated GoTrue call forwards the token", () => {
	if (!captcha.enabled) return;
	let seen = 0;
	for (const method of GATED) {
		for (const args of callArguments(SERVICE, method)) {
			seen++;
			assert(args.includes("captchaToken"), `.auth.${method}(…) sends no captchaToken`);
		}
	}
	for (const method of ["signInWithPassword", "resetPasswordForEmail", "resend"]) {
		assert(callArguments(SERVICE, method).length > 0, `no .auth.${method}( call found`);
	}
	assert(seen >= 3);
});

Deno.test("GoTrue's CAPTCHA refusal is mapped, never surfaced raw", () => {
	if (!captcha.enabled) return;
	assert(SERVICE.includes("isGoTrueCaptchaRefusal(error)"));
});

Deno.test("the confirmation sent right after /join goes through the service role", () => {
	assert(SERVICE.includes('via === "provisioned" ? getServiceClient() : getAnonClient()'));
	assertEquals(SERVICE.match(/dispatchConfirmation\([^,()]+, "provisioned"\)/g)?.length, 2);
});

Deno.test("/join verifies the token itself, before any account is created", () => {
	const route = read("apps/web/routes/api/auth/join.ts");
	const check = route.indexOf("refuseIfCaptchaFails(");
	assert(check > 0, "/api/auth/join never verifies the Turnstile token");
	assert(check < route.indexOf("provisionAccount("), "the check must come before provisioning");
});

Deno.test("every anonymous auth body accepts the token", () => {
	const token = { captchaToken: "tok" };
	assertEquals(
		LoginSchema.parse({ identifier: "a@b.co", password: "x", ...token }).captchaToken,
		"tok",
	);
	assertEquals(ForgotPasswordSchema.parse({ email: "a@b.co", ...token }).captchaToken, "tok");
	assertEquals(ResendSchema.parse({ email: "a@b.co", ...token }).captchaToken, "tok");
	assert("captchaToken" in IndividualJoinSchema.shape);
	assert("captchaToken" in EnterpriseJoinSchema.shape);
	for (const route of ["login.ts", "forgot-password.ts", "resend.ts"]) {
		assert(
			read(`apps/web/routes/api/auth/${route}`).includes("captchaToken"),
			`${route} drops the token`,
		);
	}
});
