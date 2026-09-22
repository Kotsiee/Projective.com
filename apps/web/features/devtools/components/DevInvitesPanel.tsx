import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/dev-invites.css";
import type { MemberInvite, SentInvitesPage } from "@projective/types/projects";
import { MembersService } from "@features/projects/core/MembersService.ts";
import { logger } from "@web/utils/logger.ts";
import { IconInvites } from "./dev-glyphs.tsx";

/**
 * DevInvitesPanel — the body of the Dev Tools **Invites** window: every invitation the signed-in
 * developer has SENT, grouped by project, each with its lifecycle state and — while it is still open —
 * a **Force accept** / **Force reject** pair that records the invitee's answer on their behalf, so an
 * invite flow can be walked through every state without signing into a second account.
 *
 * A QA instrument, not a product surface: it reads `/api/projects/invites/sent` and writes
 * `/api/projects/invites/decide`, both of which the SERVER answers 404 anywhere but development
 * (`DENO_ENV`), and it is mounted only through the build-excluded {@link DevTools} island. A forced
 * answer runs the SAME fat-service path a real answer runs (`projects.fn_apply_invitation_decision`
 * on the live branch, the write-store overlay on the stub), so what the members page shows afterwards
 * is exactly what it would show for a real invitee — that is the whole point of forcing it here rather
 * than faking a row on the page.
 *
 * Every mutation follows the SERVER's answer: the row is replaced by the invitation the service
 * returns, never flipped optimistically, because the service is the thing being tested.
 */

type Group = SentInvitesPage["projects"][number];

/** A row with a write in flight, so its pair is disabled and cannot be double-pressed. */
type Busy = ReadonlySet<string>;

const STATUS_LABEL: Record<MemberInvite["status"], string> = {
	pending: "Pending",
	accepted: "Accepted",
	declined: "Declined",
	expired: "Expired",
};

export function DevInvitesPanel(): JSX.Element {
	const page = useSignal<SentInvitesPage | null>(null);
	const loading = useSignal(false);
	const error = useSignal<string | null>(null);
	const busy = useSignal<Busy>(new Set<string>());
	/** The last outcome, said once beneath the list. */
	const note = useSignal<string | null>(null);
	const reqId = useRef(0);

	async function load(): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		error.value = null;
		const res = await MembersService.sentInvites();
		if (my !== reqId.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			page.value = null;
			error.value = res.message ?? "The invitations could not be read.";
			return;
		}
		page.value = res.data.page;
	}

	useEffect(() => {
		void load();
	}, []);

	async function decide(group: Group, invite: MemberInvite, decision: "accept" | "decline") {
		if (busy.value.has(invite.id)) return;
		busy.value = new Set([...busy.value, invite.id]);
		note.value = null;
		const res = await MembersService.decideInvite({
			projectId: group.id,
			inviteId: invite.id,
			decision,
		});
		const next = new Set(busy.value);
		next.delete(invite.id);
		busy.value = next;
		if (!res.ok) {
			note.value = res.message ?? "The decision could not be recorded.";
			logger.warn("Dev: forced invitation decision refused", { inviteId: invite.id, decision });
			return;
		}
		logger.info("Dev: forced invitation decision", { inviteId: invite.id, decision });
		note.value = res.message ?? (decision === "accept" ? "Accepted." : "Declined.");
		// The server's row replaces ours; a row the server no longer lists (retired) is dropped.
		const current = page.value;
		if (!current) return;
		const returned = res.data?.invite ?? null;
		page.value = {
			...current,
			projects: current.projects.map((g) =>
				g.id !== group.id ? g : {
					...g,
					invites: returned
						? g.invites.map((row) => (row.id === invite.id ? returned : row))
						: g.invites.filter((row) => row.id !== invite.id),
				}
			),
		};
	}

	const data = page.value;
	// Every project the viewer owns, INCLUDING the ones with nothing sent: a project that is absent
	// from this window reads as a project the tool failed to find, where a project with an honest
	// empty line reads as a project nobody has been invited to yet.
	const groups = data?.projects ?? [];

	return (
		<div class="dev-inv" aria-busy={loading.value ? "true" : undefined}>
			<div class="dev-inv__head">
				<p class="dev-inv__lead">
					<span class="dev-inv__icon" aria-hidden="true">
						<IconInvites />
					</span>
					Invitations you have sent, per project. Forcing an answer records it AS the invitee,
					through the same path a real answer takes.
				</p>
				<button
					type="button"
					class="dev-inv__refresh"
					onClick={() => void load()}
					disabled={loading.value}
				>
					{loading.value ? "Loading…" : "Refresh"}
				</button>
			</div>

			{error.value && <p class="dev-inv__error" role="alert">{error.value}</p>}

			{data && groups.length === 0 && !error.value && (
				<p class="dev-inv__empty">
					You own no open projects. Create one, hire someone from a profile, then come back here to
					force their answer.
				</p>
			)}

			{groups.map((group) => (
				<section key={group.id} class="dev-inv__group" aria-label={group.title}>
					<div class="dev-inv__grouphead">
						<a class="dev-inv__project" href={`/projects/${group.id}/members`}>{group.title}</a>
						<span class="dev-inv__meta">
							{group.status} · {group.invites.length}{" "}
							{group.invites.length === 1 ? "invitation" : "invitations"}
						</span>
					</div>
					{group.invites.length === 0 && <p class="dev-inv__none">No invitations sent.</p>}
					<ul class="dev-inv__list">
						{group.invites.map((invite) => {
							const wait = busy.value.has(invite.id);
							const open = invite.status === "pending";
							return (
								<li key={invite.id} class="dev-inv__row" data-status={invite.status}>
									<div class="dev-inv__main">
										<span class="dev-inv__who">{invite.handle ?? invite.email}</span>
										<span class="dev-inv__facts">
											<span class="dev-inv__status" data-status={invite.status}>
												{STATUS_LABEL[invite.status]}
											</span>
											<span aria-hidden="true">·</span>
											<span>{invite.stageName ?? "Whole project"}</span>
											<span aria-hidden="true">·</span>
											<span>{invite.role}</span>
											{invite.placeholder && (
												<>
													<span aria-hidden="true">·</span>
													<span>placeholder</span>
												</>
											)}
										</span>
									</div>
									{open && (
										<div class="dev-inv__actions">
											<button
												type="button"
												class="dev-inv__btn"
												data-tone="accept"
												disabled={wait}
												onClick={() => void decide(group, invite, "accept")}
											>
												Force accept
											</button>
											<button
												type="button"
												class="dev-inv__btn"
												data-tone="reject"
												disabled={wait}
												onClick={() =>
													void decide(group, invite, "decline")}
											>
												Force reject
											</button>
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</section>
			))}

			{note.value && <p class="dev-inv__note" role="status">{note.value}</p>}
		</div>
	);
}
