/**
 * Channel index — the bare `/projects/[projectId]/[channelId]` resolves to the Chat view (the default
 * tab). Re-exports the Chat page so the base URL and `.../chat` render identically under the shared
 * channel layout + header.
 */
export { default } from "./chat.tsx";
