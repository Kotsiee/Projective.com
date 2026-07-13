/**
 * Lightweight, dependency-free field validators for the auth islands (immediate client-side UX
 * feedback). The authoritative check is the Zod schema in {@link ./schema.ts} run at the API stub;
 * these mirror it so users get instant messages without shipping Zod into the island bundle.
 *
 * Every validator returns `null` when valid, or a short human-readable error string.
 */

import { RESERVED_HANDLES } from "./options.ts";

/** Pragmatic email shape check (authoritative verification happens via the emailed link/code). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Handles/usernames: 3–20 chars, alphanumeric + underscore, must start with a letter. */
export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
/** Loose international phone shape: optional +, digits, spaces, dashes, parens. */
export const PHONE_RE = /^[+]?[()\d\s-]{7,20}$/;
/** A domain or URL — `example.com`, `www.example.com`, or `https://example.com/path`. */
export const WEBSITE_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

export function requiredError(value: string, label = "This field"): string | null {
	return value.trim().length === 0 ? `${label} is required.` : null;
}

export function emailError(value: string): string | null {
	if (value.trim().length === 0) return "Email is required.";
	return EMAIL_RE.test(value.trim()) ? null : "Enter a valid email address.";
}

export function usernameError(value: string): string | null {
	const v = value.trim();
	if (v.length === 0) return "Username is required.";
	if (!USERNAME_RE.test(v)) {
		return "3–20 characters: letters, numbers or _, starting with a letter.";
	}
	if (RESERVED_HANDLES.has(v.toLowerCase())) return "That username is reserved — try another.";
	return null;
}

export function passwordError(value: string): string | null {
	if (value.length === 0) return "Password is required.";
	if (value.length < 8) return "Use at least 8 characters.";
	if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
		return "Mix upper- and lower-case letters and a number.";
	}
	return null;
}

export function confirmError(password: string, confirm: string): string | null {
	if (confirm.length === 0) return "Re-enter your password.";
	return password === confirm ? null : "Passwords don't match.";
}

export function phoneError(value: string, requiredField = true): string | null {
	const v = value.trim();
	if (v.length === 0) return requiredField ? "Phone number is required." : null;
	return PHONE_RE.test(v) ? null : "Enter a valid phone number.";
}

/** Website / corporate domain — optional; when present it must look like a domain or URL. */
export function websiteError(value: string, requiredField = false): string | null {
	const v = value.trim();
	if (v.length === 0) return requiredField ? "Website is required." : null;
	return WEBSITE_RE.test(v) ? null : "Enter a valid website or domain.";
}

/**
 * Rough password-strength score (0–4) for the meter — length + character-class diversity. Purely
 * presentational; the hard requirement is {@link passwordError}.
 */
export function passwordScore(value: string): number {
	if (!value) return 0;
	let score = 0;
	if (value.length >= 8) score++;
	if (value.length >= 12) score++;
	if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
	if (/\d/.test(value) && /[^\w\s]/.test(value)) score++;
	return Math.min(score, 4);
}
