import { z } from "zod";

/**
 * invites.recipients — the ONE rule for what a person typed into an invite field means, shared by
 * every invite surface (a project, a team, a business) and by the routes that receive the batch.
 *
 * A single field takes both kinds of address. What decides the kind is the text itself, never a tab
 * the inviter had to pick first:
 *
 *   - **email** — `local@domain.tld` (the same shape `org.invite_workspace_member` and
 *     `projects.invite_by_email` check), lowercased;
 *   - **handle** — a Projective username, with or without its leading `@`, lowercased.
 *
 * A paste may hold many addresses separated by commas, semicolons, spaces or new lines, and mail
 * clients' `Name <name@company.com>` mailboxes; {@link parseInviteInput} reads all of it, keeps the
 * order, drops duplicates, and hands back what it could not read so the field can keep it for fixing.
 */

// #region Shapes
/** How an invitation is addressed. */
export const InviteRecipientType = z.enum(["handle", "email"]);
export type InviteRecipientType = z.infer<typeof InviteRecipientType>;

/** The email shape every invite door checks (`^[^@\s]+@[^@\s]+\.[^@\s]+$`). */
export const INVITE_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A username as people hold them: a letter or digit, then letters, digits, `_`, `.` or `-`, 2–40 in
 * all (`projects.InviteAddressSchema`'s handle branch). Wider than the entity claim rule on purpose —
 * a person's username may hold `.` or `_`, and only the server can say whether anyone holds it.
 */
export const INVITE_HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,39}$/;

/** The longest email address an invite door accepts. */
export const INVITE_EMAIL_MAX = 160;

/** At most this many people per send — the outbound ceiling's whole window in one go. */
export const INVITE_RECIPIENTS_MAX = 10;

/**
 * One person an invite batch addresses, at the role they are offered. `roleId` is the surface's own
 * role vocabulary — a workspace role id, or a project's assignable role — validated by the surface.
 */
export const InviteRecipientSchema = z.object({
	type: InviteRecipientType,
	value: z.string().trim().min(1).max(INVITE_EMAIL_MAX).transform((v) => v.toLowerCase()),
	roleId: z.string().trim().min(1).max(64),
}).superRefine((r, ctx) => {
	const okay = r.type === "email" ? INVITE_EMAIL_RE.test(r.value) : INVITE_HANDLE_RE.test(r.value);
	if (!okay) {
		ctx.addIssue({
			code: "custom",
			path: ["value"],
			message: r.type === "email" ? "Enter a valid email address." : "Enter a valid @handle.",
		});
	}
});
export type InviteRecipient = z.infer<typeof InviteRecipientSchema>;

/** A batch of recipients: at least one, at most {@link INVITE_RECIPIENTS_MAX}, each address once. */
export const InviteRecipientsSchema = z.array(InviteRecipientSchema)
	.min(1, "Add at least one person.")
	.max(INVITE_RECIPIENTS_MAX, `Invite at most ${INVITE_RECIPIENTS_MAX} people at a time.`)
	.transform((list) => {
		const seen = new Set<string>();
		return list.filter((r) => {
			const key = recipientKey(r);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

/** One address a send did NOT issue, with the server's own sentence and a short code. */
export const InviteRecipientRefusalSchema = z.object({
	/** {@link recipientAddress} of the refused recipient (`@handle` or the email). */
	address: z.string().max(INVITE_EMAIL_MAX + 1),
	message: z.string().max(240),
	code: z.string().max(40),
});
export type InviteRecipientRefusal = z.infer<typeof InviteRecipientRefusalSchema>;
// #endregion

// #region Reading what was typed
/** A recipient before a role is attached — what the field read. */
export interface ParsedRecipient {
	type: InviteRecipientType;
	/** Lowercased; a handle without its `@`. */
	value: string;
}

/** What {@link parseInviteInput} read: the recipients, in order and once each, and the leftovers. */
export interface ParsedInviteInput {
	recipients: ParsedRecipient[];
	/** Pieces that are neither an email nor a handle, as typed, for the field to keep. */
	invalid: string[];
}

/** A mail client's mailbox (`"Ana Ruiz" <ana@company.com>`): the address inside the brackets wins. */
const MAILBOX_RE = /[^,;<>\n]*<\s*([^<>\s]+@[^<>\s]+)\s*>/g;

/** Where one address ends and the next begins. */
const SEPARATOR_RE = /[\s,;]+/;

/**
 * Classify ONE piece of text, or `null` when it is neither. Email first: an address holds an `@`
 * between its parts, a handle only ever leads with one. Quotes, angle brackets and a `mailto:` are
 * stripped; a handle loses its leading `@`s.
 */
export function classifyInviteToken(raw: string): ParsedRecipient | null {
	const text = raw.trim().replace(/^["'<(]+|["'>),.]+$/g, "").replace(/^mailto:/i, "")
		.toLowerCase();
	if (text === "") return null;
	if (text.length <= INVITE_EMAIL_MAX && INVITE_EMAIL_RE.test(text)) {
		return { type: "email", value: text };
	}
	const handle = text.replace(/^@+/, "");
	if (INVITE_HANDLE_RE.test(handle)) return { type: "handle", value: handle };
	return null;
}

/** The identity of a recipient, for dedupe — the same person typed twice is one row. */
export function recipientKey(r: Pick<ParsedRecipient, "type" | "value">): string {
	return `${r.type}:${r.value.toLowerCase()}`;
}

/** How a recipient is written back to a person: `@ravi` or `ana@company.com`. */
export function recipientAddress(r: Pick<ParsedRecipient, "type" | "value">): string {
	return r.type === "handle" ? `@${r.value}` : r.value;
}

/**
 * Read everything in a field or a paste. Mailboxes are reduced to their address first, then the text
 * is split on commas, semicolons, spaces and new lines; each piece is classified, duplicates are
 * dropped (first wins), and pieces that are neither kind come back in `invalid`.
 */
export function parseInviteInput(text: string): ParsedInviteInput {
	const flattened = text.replace(MAILBOX_RE, (_whole, address: string) => ` ${address} `);
	const recipients: ParsedRecipient[] = [];
	const invalid: string[] = [];
	const seen = new Set<string>();
	for (const piece of flattened.split(SEPARATOR_RE)) {
		if (piece.trim() === "") continue;
		const parsed = classifyInviteToken(piece);
		if (!parsed) {
			invalid.push(piece.trim());
			continue;
		}
		const key = recipientKey(parsed);
		if (seen.has(key)) continue;
		seen.add(key);
		recipients.push(parsed);
	}
	return { recipients, invalid };
}

/**
 * Whether a keystroke should commit what is in the field: a separator was just typed. Enter is the
 * field's own keydown, so it is not judged here.
 */
export function endsWithSeparator(text: string): boolean {
	return /[\s,;]$/.test(text);
}
// #endregion
