/**
 * Messaging domain types — sourced from the Zod SSOT at `@projective/types/messaging`.
 *
 * App components/islands import shapes through this shim (the stable in-feature path); the fat
 * `@projective/backend` service imports the packages directly. The message BODY shapes live in the
 * projects domain (unified by `chatId`), so they are re-exported here for the conversation view.
 * Mirrors `projects/types/projects-types.ts`.
 */
export * from "@projective/types/messaging";
export type {
	ChatMessage,
	MessageAttachment,
	MessagePage,
	MessageSender,
} from "@projective/types/projects";
