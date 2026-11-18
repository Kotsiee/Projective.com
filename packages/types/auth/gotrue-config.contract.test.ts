/**
 * The local GoTrue (`supabase/config.toml`) enforces the app's password rule, checks the OAuth nonce
 * and guards a password change (Decision #449). A drifted value fails test:unit. The hosted
 * project's equivalents are listed in SYSTEM_ARCHITECTURE.md §Authentication & Identity.
 */
import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { PASSWORD_MIN_LENGTH, PasswordSchema } from "./password.ts";

// #region GoTrue's rule
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

/** The character sets the CLI hands GoTrue for each `password_requirements` value. */
const REQUIRED_SETS: Record<string, string[]> = {
	"": [],
	letters_digits: [LOWER + UPPER, DIGITS],
	lower_upper_letters_digits: [LOWER, UPPER, DIGITS],
	lower_upper_letters_digits_symbols: [LOWER, UPPER, DIGITS, SYMBOLS],
};

/** GoTrue's `MaxPasswordLength`: bcrypt reads no further. */
const GOTRUE_MAX_BYTES = 72;

const bytes = (value: string) => new TextEncoder().encode(value).length;

function gotrueAccepts(minLength: number, sets: string[], value: string): boolean {
	return bytes(value) >= minLength && bytes(value) <= GOTRUE_MAX_BYTES &&
		sets.every((set) => [...value].some((char) => set.includes(char)));
}

const PROBES = [
	"Abcdefg1",
	"Abcdef1",
	"Abcde1",
	"abcdefg1",
	"ABCDEFG1",
	"Abcdefgh",
	"12345678",
	"Abcdefg!",
	"Aa1" + "x".repeat(69),
	"Aa1" + "x".repeat(70),
	"Aa1" + "é".repeat(34),
	"Aa1" + "é".repeat(35),
	"Aa1éééé",
	"Abcdefg١",
];
// #endregion

// #region Settings
interface GoTrueSettings {
	minimumPasswordLength: unknown;
	passwordRequirements: unknown;
	securePasswordChange: unknown;
	skipNonceCheck: Record<string, unknown>;
}

function table(value: unknown, key: string): Record<string, unknown> {
	const entry = (value as Record<string, unknown> | undefined)?.[key];
	return entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
}

function settingsOf(config: Record<string, unknown>): GoTrueSettings {
	const auth = table(config, "auth");
	const external = table(auth, "external");
	const skipNonceCheck: Record<string, unknown> = {};
	for (const provider of Object.keys(external)) {
		const flag = table(external, provider).skip_nonce_check;
		if (flag !== undefined) skipNonceCheck[provider] = flag;
	}
	return {
		minimumPasswordLength: auth.minimum_password_length,
		passwordRequirements: auth.password_requirements ?? "",
		securePasswordChange: table(auth, "email").secure_password_change,
		skipNonceCheck,
	};
}

function drift(settings: GoTrueSettings): string[] {
	const problems: string[] = [];
	const minLength = settings.minimumPasswordLength;
	if (minLength !== PASSWORD_MIN_LENGTH) {
		problems.push(`minimum_password_length is ${minLength}; the app's is ${PASSWORD_MIN_LENGTH}`);
	}
	const sets = REQUIRED_SETS[String(settings.passwordRequirements)];
	if (!sets) problems.push(`unknown password_requirements ${settings.passwordRequirements}`);
	if (sets && typeof minLength === "number") {
		for (const probe of PROBES) {
			const app = PasswordSchema.safeParse(probe).success;
			const gotrue = gotrueAccepts(minLength, sets, probe);
			if (app && !gotrue) problems.push(`the app accepts what GoTrue refuses: ${probe}`);
			if (/^[\x20-\x7e]*$/.test(probe) && !app && gotrue) {
				problems.push(`GoTrue accepts what the app refuses: ${probe}`);
			}
		}
	}
	if (settings.securePasswordChange !== true) problems.push("secure_password_change is not true");
	for (const [provider, skip] of Object.entries(settings.skipNonceCheck)) {
		if (skip !== false) problems.push(`[auth.external.${provider}] skip_nonce_check is ${skip}`);
	}
	return problems;
}
// #endregion

const CONFIG = settingsOf(
	parse(
		await Deno.readTextFile(new URL("../../../supabase/config.toml", import.meta.url)),
	) as Record<string, unknown>,
);

Deno.test("gotrue config: local GoTrue enforces the app's password rule, nonce and change guard", () => {
	assertEquals(CONFIG.minimumPasswordLength, PASSWORD_MIN_LENGTH);
	assertEquals(CONFIG.skipNonceCheck.google, false, "Google's nonce is checked");
	assertEquals(drift(CONFIG), []);
});

Deno.test("gotrue config: the contract catches each flipped value", () => {
	const flips: Record<string, GoTrueSettings> = {
		"minimum 6": { ...CONFIG, minimumPasswordLength: 6 },
		"minimum 12": { ...CONFIG, minimumPasswordLength: 12 },
		"no classes": { ...CONFIG, passwordRequirements: "" },
		"symbols too": { ...CONFIG, passwordRequirements: "lower_upper_letters_digits_symbols" },
		"no reauthentication": { ...CONFIG, securePasswordChange: false },
		"nonce skipped": { ...CONFIG, skipNonceCheck: { ...CONFIG.skipNonceCheck, google: true } },
	};
	for (const [name, settings] of Object.entries(flips)) {
		assert(drift(settings).length > 0, `${name} went unnoticed`);
	}
});
