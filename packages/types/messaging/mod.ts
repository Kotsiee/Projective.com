/**
 * `messaging` schema shapes — the global inbox (`/messages`) read projections: the conversation LIST
 * + single-conversation metadata + contact picker (`conversations.ts`), the Message Settings /
 * auto-response projection (`settings.ts`), and the one WRITE — posting a message into a
 * conversation (`send.ts`, with the `ChatRef` address every conversation surface shares, Decision
 * #339 ruling N1). The `comms.dm_threads` summary row and its RPC rows (`inbox_tails`,
 * `get_or_create_dm_thread`) sit beside the projections in `conversations.ts`. Message BODIES
 * inside a conversation reuse the {@link ../projects/messages.ts} projections
 * (`ChatMessage`/`MessagePage`) — a project channel and the global inbox are unified by `chatId`
 * (PRODUCT_SPEC §Unified Messaging).
 */
export * from "./conversations.ts";
export * from "./settings.ts";
export * from "./send.ts";
export * from "./contacts.ts";
export * from "./folders.ts";
export * from "./activity.ts";
export * from "./context.ts";
