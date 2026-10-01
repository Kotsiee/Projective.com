/**
 * comms.pii — the TypeScript mirror of `comms.mask_pii` (00001300): the protected phase's contact
 * filter (PRODUCT_SPEC §Messaging 1 · §3 "The Handover State"). The SQL trigger is the authority — it
 * runs on every insert path and cannot be bypassed — and this twin exists for the paths that never
 * reach it: the fixture store and the composer's instant warning.
 *
 * Same four passes, same order, same placeholders: emails, then payment links and messaging handles,
 * then `$cashtags`, then bare phone numbers (a payment URL can contain digits the phone pass would
 * otherwise eat). `pii.contract.test.ts` pins {@link SQL_PII_PATTERNS} to the migration verbatim, so
 * a pattern edited on one side fails until the other follows.
 */

/** What a mask pass found. */
export type PiiCategory = "email" | "payment_link" | "handle" | "phone";

/** The masked text and the categories that fired, in pass order. */
export interface PiiMaskResult {
	masked: string;
	categories: PiiCategory[];
}

/** The four POSIX patterns exactly as `comms.mask_pii` spells them. */
export const SQL_PII_PATTERNS: Record<PiiCategory, string> = {
	email: "[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}",
	payment_link:
		"(https?://)?(www\\.)?(paypal(\\.me)?|venmo|cash\\.?app|cash\\.me|zelle|wise\\.com|revolut\\.me|monzo\\.me|ko-?fi\\.com|buymeacoffee\\.com|t\\.me|wa\\.me|telegram\\.me)[[:graph:]]*",
	handle: "\\$[[:alpha:]][[:alnum:]_]{1,}",
	phone: "[+(]?[0-9][0-9 ().-]{6,}[0-9]",
};

const PASSES: readonly { category: PiiCategory; pattern: RegExp; placeholder: string }[] = [
	{
		category: "email",
		pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu,
		placeholder: "[email hidden]",
	},
	{
		category: "payment_link",
		pattern:
			/(https?:\/\/)?(www\.)?(paypal(\.me)?|venmo|cash\.?app|cash\.me|zelle|wise\.com|revolut\.me|monzo\.me|ko-?fi\.com|buymeacoffee\.com|t\.me|wa\.me|telegram\.me)\S*/giu,
		placeholder: "[link hidden]",
	},
	{
		category: "handle",
		pattern: /\$\p{L}[\p{L}\p{N}_]{1,}/gu,
		placeholder: "[handle hidden]",
	},
	{
		category: "phone",
		pattern: /[+(]?[0-9][0-9 ().-]{6,}[0-9]/gu,
		placeholder: "[phone hidden]",
	},
];

/** Mask every contact detail the protected phase forbids. Text with none comes back unchanged. */
export function maskPii(text: string): PiiMaskResult {
	let masked = text;
	const categories: PiiCategory[] = [];
	for (const pass of PASSES) {
		pass.pattern.lastIndex = 0;
		if (!pass.pattern.test(masked)) continue;
		pass.pattern.lastIndex = 0;
		masked = masked.replace(pass.pattern, pass.placeholder);
		categories.push(pass.category);
	}
	return { masked, categories };
}

/** Whether {@link maskPii} would change this text — the composer's warning test. */
export function containsPii(text: string): boolean {
	return maskPii(text).categories.length > 0;
}
