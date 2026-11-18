import { z } from "zod";

/**
 * auth/password — the one password rule (Decision #449). `/join`, the `/forgot-password` reset and
 * the Settings change (which mails that reset) validate a new password with {@link PasswordSchema};
 * the auth islands' instant check reads {@link passwordIssue}, so the form, the route and the service
 * cannot disagree. GoTrue enforces the same floor and classes (`supabase/config.toml` `[auth]`, pinned
 * by `gotrue-config.contract.test.ts`) and a 72-byte ceiling of its own, which this rule mirrors.
 * Sign-in never applies it: a password set before the rule still signs in.
 */

// #region Rule
/** The fewest characters a password may have; GoTrue's `minimum_password_length`. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * GoTrue refuses a password over 72 UTF-8 bytes whatever its policy (bcrypt reads no further), so an
 * accented letter or an emoji uses up more than one.
 */
export const PASSWORD_MAX_BYTES = 72;

/**
 * The classes a password must each contain: GoTrue's `lower_upper_letters_digits`, which tests ASCII
 * only, as these patterns do.
 */
export const PASSWORD_CLASSES: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /[0-9]/];
// #endregion

// #region Check
const encoder = new TextEncoder();

/** The first way `value` breaks the password rule, in the form's copy, or `null` when it passes. */
export function passwordIssue(value: string): string | null {
	if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
	if (encoder.encode(value).length > PASSWORD_MAX_BYTES) {
		return "Use a shorter password: 72 characters at most, fewer with accents or emoji.";
	}
	if (!PASSWORD_CLASSES.every((pattern) => pattern.test(value))) {
		return "Mix upper- and lower-case letters and a number.";
	}
	return null;
}

/** A new password, as sign-up, reset and change accept it. */
export const PasswordSchema = z.string().superRefine((value, ctx) => {
	const issue = passwordIssue(value);
	if (issue) ctx.addIssue({ code: "custom", message: issue });
});
// #endregion
