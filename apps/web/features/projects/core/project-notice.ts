/**
 * project-notice — the pure half of the `?notice=` flash message: the parameter's name, the codes it
 * may carry, the sentence each one renders, and how the parameter is read from and written into a URL.
 *
 * ## Why the flash travels in the URL
 *
 * A project that does not exist is discovered on the SERVER, in the route handler, before a byte of
 * the engagement page has been sent. So the bounce is an HTTP `303` rather than a client-side one:
 * the wrong page is never rendered at all, which is the only way to be certain nothing half-built
 * flashes on the way out. A client-side redirect cannot make that promise — it has to paint something
 * first in order to run.
 *
 * That leaves the message without a channel, because the browser is now making a fresh request to a
 * different route, and the query string is the smallest one that works. A cookie flash would need a
 * `Set-Cookie` on the redirect and a read-and-clear on the next request, and it is shared across the
 * whole origin: two tabs landing on `/projects` at once would race for one message and one of them
 * would silently lose it. A query parameter belongs to the navigation that carried it, and to nothing
 * else.
 *
 * No DOM and no signals here: every rule is a function of strings, so it is unit-testable and the
 * island is left with only the browser plumbing. Mirrors `ticket-link.ts`, which reads, acts on and
 * strips `?tkv=` in exactly this shape.
 */

// #region The parameter
/** The query-string key carrying a one-shot message for the page being navigated TO. */
export const NOTICE_PARAM = "notice";

/** Where a project miss lands. The list is the only page that is always there to receive it. */
export const PROJECTS_PATH = "/projects";

/** The codes this app may flash. A code, not a sentence: a URL is not where copy belongs. */
export type ProjectNoticeCode = "project-not-found";

/**
 * The sentence each code renders.
 *
 * "does not exist" is deliberately what an INACCESSIBLE project is told too. The read behind the
 * guard cannot tell the two apart on purpose — a project the viewer may not see and one that was
 * never there report identically, so the address bar is not an existence oracle for engagements
 * somebody else owns (the same rule `/share/[slug]` applies to a revoked link).
 */
const MESSAGES: Readonly<Record<ProjectNoticeCode, string>> = {
	"project-not-found": "Project does not exist",
};

/**
 * The raw `notice` value in a query string, or `null` when the key is absent.
 *
 * Deliberately returns an UNRECOGNISED value rather than dropping it: the island has to strip a stale
 * or hand-typed parameter from the address bar, which it cannot do if it never learns one was there.
 * Whether the value says anything is {@link noticeMessage}'s question.
 */
export function readNoticeParam(search: string): string | null {
	const value = new URLSearchParams(search).get(NOTICE_PARAM);
	return value === null || value.length === 0 ? null : value;
}

/** The sentence for a raw parameter value, or `null` when it names no code we know. */
export function noticeMessage(value: string | null): string | null {
	if (value === null) return null;
	return Object.hasOwn(MESSAGES, value) ? MESSAGES[value as ProjectNoticeCode] : null;
}

/**
 * `href` (a `pathname + search [+ hash]` string) with the `notice` parameter set to `code`, or removed
 * when `code` is `null`. Every OTHER parameter is preserved verbatim, in its original order, so the
 * flash can ride alongside a filter or a `?tkv=` deep link and the strip afterwards takes only itself.
 *
 * Idempotent: removing a parameter that is not there returns an equal string, so the island can
 * compare before it touches history.
 */
export function withNoticeParam(href: string, code: ProjectNoticeCode | null): string {
	const hashAt = href.indexOf("#");
	const hash = hashAt >= 0 ? href.slice(hashAt) : "";
	const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const queryAt = beforeHash.indexOf("?");
	const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
	const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
	if (code === null) params.delete(NOTICE_PARAM);
	else params.set(NOTICE_PARAM, code);
	const search = params.toString();
	return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

/**
 * The `Location` a bounced request should carry — the projects list, flashing `code`.
 *
 * Built here rather than interpolated at the call site so the route and the island cannot come to
 * disagree about the parameter's name.
 */
export function projectsNoticeHref(code: ProjectNoticeCode): string {
	return withNoticeParam(PROJECTS_PATH, code);
}
// #endregion
