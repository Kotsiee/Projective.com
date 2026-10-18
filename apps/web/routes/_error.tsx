import { HttpError, page } from "fresh";
import { Container } from "@projective/ui/layout";
import { EmptyState } from "@projective/ui/utils";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { LogBackendService } from "@server/services/logging/LogBackendService.ts";

interface ErrorCopy {
	title: string;
	description: string;
}

const NOT_FOUND: ErrorCopy = {
	title: "This page doesn’t exist",
	description: "The link may be out of date, or the page may have moved.",
};

const SERVER_ERROR: ErrorCopy = {
	title: "Something went wrong",
	description: "We couldn’t load this page. It’s been reported, and it’s usually back in a moment.",
};

const UNAVAILABLE: ErrorCopy = {
	title: "Projective is briefly unavailable",
	description:
		"We couldn’t check your sign-in just now. You’re still signed in — try again in a moment.",
};

function copyFor(status: number): ErrorCopy {
	if (status === 404) return NOT_FOUND;
	if (status === 503) return UNAVAILABLE;
	if (status >= 500) return SERVER_ERROR;
	return { title: "This page can’t be shown", description: "The request couldn’t be completed." };
}

/**
 * The root error route — every uncaught `HttpError` or exception in a page, layout, handler or API
 * route lands here. A 5xx is recorded through the fat {@link LogBackendService} (console with its
 * stack, plus an `ops.log_entries` row when logging is live); 4xx are expected traffic and are not.
 * `/api/*` callers get the JSON failure envelope instead of a page.
 *
 * The page is the root fallback — it renders outside every group layout (no shell), so its one `<h1>`
 * is the empty state's title, and `EmptyState`'s sheet is global (`client.ts`) because no island on
 * this page carries it. The public editorial routes answer their own 404s in their frames instead
 * (help, articles, legal, changelog).
 */
export const handler = define.handlers(async (ctx) => {
	const status = ctx.error instanceof HttpError ? ctx.error.status : 500;
	if (status >= 500) {
		await LogBackendService.recordServerError(
			ctx.error,
			{ path: ctx.url.pathname, method: ctx.req.method, status },
			readActor(ctx),
		);
	}
	if (ctx.url.pathname.startsWith("/api/")) {
		return Response.json({ ok: false, message: copyFor(status).title }, { status });
	}
	ctx.state.title = `${copyFor(status).title} · Projective`;
	const retryHref = status === 503 ? ctx.url.pathname + ctx.url.search : null;
	return page({ status, retryHref }, { status });
});

export default define.page<typeof handler>(function ErrorPage({ data }) {
	const { title, description } = copyFor(data.status);
	const href = data.retryHref ?? "/";
	return (
		<Container as="main" size="md" class="page">
			<EmptyState
				size="lg"
				heading={1}
				title={title}
				description={description}
				actions={
					<a
						class="ui-button ui-button--primary ui-button--outlined ui-button--size-md ui-button--rounded"
						href={href}
					>
						{data.retryHref ? "Try again" : "Go home"}
					</a>
				}
			/>
		</Container>
	);
});
