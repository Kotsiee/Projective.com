/**
 * @projective/types/contact — the Zod SSOT for `/contact` (Decision #276): the intake's intents and
 * per-intent submissions, the stored `ops.contact_requests` row and its unified-machine lifecycle,
 * the human reference, and the attachment handshake over the files upload pipeline.
 *
 * Imported by sub-path only (it is not in the root barrel, like `ops` and `comms`).
 */
export * from "./intake.ts";
export * from "./attachments.ts";
