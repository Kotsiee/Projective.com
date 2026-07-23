/**
 * `messaging` schema shapes — the global inbox (`/messages`) read projections: the conversation LIST
 * + single-conversation metadata + contact picker (`conversations.ts`) and the Message Settings /
 * auto-response projection (`settings.ts`). Message BODIES inside a conversation reuse the
 * {@link ../projects/messages.ts} projections (`ChatMessage`/`MessagePage`) — a project channel and
 * the global inbox are unified by `chatId` (PRODUCT_SPEC §Unified Messaging).
 */
export * from "./conversations.ts";
export * from "./settings.ts";
