/** Static `/projects/[projectSlug]/*` views that share the `[channelId]` segment's position. */
const PROJECT_VIEWS: ReadonlySet<string> = new Set([
	"attachments",
	"board",
	"calendar",
	"edit",
	"files",
	"members",
	"preview",
	"submissions",
	"timeline",
]);

function segments(pathname: string): string[] {
	return pathname.split("/").filter(Boolean);
}

/** A pathname with its trailing slash dropped, so `/a/b/` and `/a/b` name one document. */
export function normalisePath(pathname: string): string {
	return `/${segments(pathname).join("/")}`;
}

/**
 * Whether a pathname is a full chat view the floating pop-out duplicates: a conversation
 * (`/messages/[conversationId]`) or a project channel's Chat tab (`/projects/[projectSlug]/[channelId]`
 * and its `/chat` alias, the discussion room included). A channel's other tabs are not.
 */
export function isChatRoute(pathname: string): boolean {
	const parts = segments(pathname);
	if (parts[0] === "messages") return parts.length === 2;
	if (parts[0] !== "projects" || parts.length < 3 || parts.length > 4) return false;
	if (PROJECT_VIEWS.has(parts[2])) return false;
	return parts.length === 3 || parts[3] === "chat";
}

/**
 * Whether the pop-out must be dismissed on arriving at `pathname`: it is a chat view, reached from a
 * different document than the one the window last showed on. The document it was spawned on (and a
 * reload of it) keeps the window.
 */
export function shouldDismissPopout(lastPath: string | undefined, pathname: string): boolean {
	if (!isChatRoute(pathname)) return false;
	return lastPath === undefined || normalisePath(lastPath) !== normalisePath(pathname);
}
