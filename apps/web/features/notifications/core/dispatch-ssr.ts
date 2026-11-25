import { DispatchRequestSchema } from "@projective/types/comms";
import { invalidFields, serviceResponse } from "@web/utils/service-response.ts";
import {
	DEFAULT_DIGEST_LIMIT,
	DigestMailService,
	MAX_DIGEST_LIMIT,
} from "@server/services/comms/DigestMailService.ts";
import {
	DEFAULT_DISPATCH_LIMIT,
	MAX_DISPATCH_LIMIT,
	NotificationDispatchService,
} from "@server/services/comms/NotificationDispatchService.ts";

/**
 * dispatch-ssr — the HTTP half of the notification dispatcher's two machine-to-app doors (Decision
 * #344 (a)) and of the digest sender's (PROJECTS NO2), kept here so the routes stay one line and the
 * 404 / 200 contract is unit-tested. Server only: never import it from an island.
 *
 * All three check `COMMS_DISPATCH_SECRET` in constant time BEFORE reading anything else, and answer 404
 * otherwise, as the cron routes do: an endpoint that sends on Projective's behalf does not advertise
 * that it exists.
 */

/** The dispatcher, as the doors see it; the live service by default, a stub in tests. */
export interface DispatchDoorDeps {
	isAuthorised: (authorization: string | null) => boolean;
	dispatch: typeof NotificationDispatchService.dispatch;
}

const LIVE: DispatchDoorDeps = {
	isAuthorised: (authorization) => NotificationDispatchService.isDispatchAuthorised(authorization),
	dispatch: (notificationId, limit) => NotificationDispatchService.dispatch(notificationId, limit),
};

const notFound = () => new Response(null, { status: 404 });

/**
 * `POST /api/comms/dispatch` — the `comms.notifications` trigger's post: `{ notification_id }`, then one
 * pass over that notification's deliveries. 422 for any other body.
 */
export async function answerDispatch(
	req: Request,
	deps: DispatchDoorDeps = LIVE,
): Promise<Response> {
	if (!deps.isAuthorised(req.headers.get("authorization"))) return notFound();
	const parsed = DispatchRequestSchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return invalidFields(parsed.error.issues);
	return serviceResponse(await deps.dispatch(parsed.data.notification_id, DEFAULT_DISPATCH_LIMIT));
}

/**
 * `POST /api/comms/cron/dispatch?limit=…` — the `comms-dispatch-sweep` job: one pass over every due
 * delivery, the batch size bounded to 1–500. The body is ignored.
 */
export async function answerDispatchSweep(
	req: Request,
	url: URL,
	deps: DispatchDoorDeps = LIVE,
): Promise<Response> {
	if (!deps.isAuthorised(req.headers.get("authorization"))) return notFound();
	const requested = Number(url.searchParams.get("limit") ?? DEFAULT_DISPATCH_LIMIT) ||
		DEFAULT_DISPATCH_LIMIT;
	const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_DISPATCH_LIMIT);
	return serviceResponse(await deps.dispatch(null, limit));
}

/** The digest sender, as its door sees it; the live service by default, a stub in tests. */
export interface DigestDoorDeps {
	isAuthorised: (authorization: string | null) => boolean;
	send: (limit: number) => ReturnType<typeof DigestMailService.send>;
}

const LIVE_DIGESTS: DigestDoorDeps = {
	isAuthorised: (authorization) => NotificationDispatchService.isDispatchAuthorised(authorization),
	send: (limit) => DigestMailService.send(limit),
};

/**
 * `POST /api/comms/cron/digests?limit=…` — the `comms-digest-send` job (PROJECTS NO2): one pass that
 * mails every leased daily and weekly digest, the batch bounded to 1–500 (default 50). The same
 * bearer as the dispatcher's doors; the body is ignored.
 */
export async function answerDigestSweep(
	req: Request,
	url: URL,
	deps: DigestDoorDeps = LIVE_DIGESTS,
): Promise<Response> {
	if (!deps.isAuthorised(req.headers.get("authorization"))) return notFound();
	const requested = Number(url.searchParams.get("limit") ?? DEFAULT_DIGEST_LIMIT) ||
		DEFAULT_DIGEST_LIMIT;
	const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_DIGEST_LIMIT);
	return serviceResponse(await deps.send(limit));
}
