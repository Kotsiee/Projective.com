/**
 * `invites` shapes — what every invite surface shares: the single address field's reading rule
 * (email or handle, decided by the text) and the recipient batch the invite routes receive.
 *
 *   - `recipients` — {@link InviteRecipientSchema}, the parser, and the per-address refusal.
 *
 * The surface-specific payloads (a project's stage, a workspace's roles and seats) stay in
 * `projects` and `workspace`, which compose these.
 */
export * from "./recipients.ts";
