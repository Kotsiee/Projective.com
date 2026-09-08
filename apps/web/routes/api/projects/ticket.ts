import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { BoardCard, BoardPage } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/ticket?slug=tkt-…` — the thin route behind the `?tkv=` deep
 * link: one ticket by its slug, together with the board it belongs to (the modal needs the stages,
 * the roster and every sibling card, not the ticket alone). HTTP parse + a shape guard, then delegate
 * to the fat {@link ProjectBackendService.ticket}.
 *
 * **Signed-in only, and that is an identity check rather than a capability one.** The sibling reads
 * answer a guest from the fixture corpus; this one does not, because its whole job is to open a
 * modal on a page the viewer merely happened to be on, and a guest following a ticket link must be
 * sent to sign in rather than shown a fixture. Which tickets a signed-in viewer may open is decided
 * by the fat read (RLS on the live path, provider scoping on the stub one), never here.
 *
 * All three verbs come from {@link defineReadRoute}; the guest refusal is returned from inside
 * `resolve` so `HEAD` reports the same 401 with the body stripped by the factory.
 */
export const handler = define.handlers(
	defineReadRoute<{ page: BoardPage; card: BoardCard }>({
		resolve: (ctx) => {
			const actor = readActor(ctx);
			if (!actor.userId) {
				return Response.json(
					{ ok: false, message: "Sign in to open a ticket." },
					{ status: 401 },
				);
			}
			const slug = ctx.url.searchParams.get("slug");
			if (!slug) {
				return Response.json({ ok: false, message: "Missing slug." }, { status: 400 });
			}
			return ProjectBackendService.ticket(slug, actor);
		},
		toBody: toProjectsBody,
	}),
);
