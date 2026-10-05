import type { ComponentChildren, JSX, VNode } from "preact";
import { Avatar } from "@projective/ui/display";
import { styleVars } from "@ui/core/style.ts";
import type { MemberPresence, MemberRole } from "../types/projects-types.ts";
import { profileHref } from "../core/routing.ts";
import { cardAccent } from "@web/features/explore/core/accent.ts";
import { isModifiedClick } from "@web/features/explore/core/routing.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { AuthorityMark, PresenceDot } from "./MemberBadges.tsx";

/**
 * MemberCard — one person on the Members tab, in the explore profile card's anatomy (Decision #74(C)):
 * a banner seam, a large avatar centred on it and overlapping it by half, the centred name and
 * `@handle`, then LEFT-aligned running text (the headline, a middot meta line, an optional quoted
 * note) and a foot. Identity centres because it is one focal object; everything below it is scanned
 * down a shared left edge.
 *
 * A roster card has no photograph to lead with, so it is a CONSOLE-density card (DESIGN_SYSTEM §A.3:
 * `--card-radius`, `--card-pad`) and its banner is a solid tone of the card's deterministic accent
 * rather than a masked cover.
 *
 * **Click matrix.** When the person has a profile, the card carries a stretched `<a href="/@handle">`:
 * a plain left-click (or Enter) opens the in-place preview through `onOpen`; a middle-click or
 * ⌘/Ctrl/Shift-click falls through to the browser and opens the full profile in a new tab
 * ({@link isModifiedClick}, the explore card's guard). The corner actions, the foot's buttons and
 * every tooltip target sit above the link, so they act on their own.
 *
 * Presentation only — every section composes it with its own slots (`MemberSectionCards`).
 */
export interface MemberCardPerson {
	name: string;
	/** Bare or `@`-prefixed handle; `null` for an email-only invitee, whose card does not link. */
	handle: string | null;
	avatar: string | null;
	/** An entity (a team applicant) — a rounded-square avatar, never a person's circle. */
	entity?: boolean;
}

export interface MemberCardProps {
	person: MemberCardPerson;
	/** Stable seed for the banner accent (the row id). */
	seed: string;
	/** The role, when known — drives the authority crown and accent ring. */
	role?: MemberRole;
	/** The acting viewer's own card. */
	viewer?: boolean;
	presence?: MemberPresence;
	/** A lifecycle tag pinned top-left on the banner (invitation status · attendance). */
	status?: VNode | null;
	/** The corner actions (Message · kebab), pinned top-right. */
	actions?: VNode | null;
	/** The headline line — the role, or what the request/invitation is for. */
	headline?: ComponentChildren;
	/** Middot-separated facts in the meta register. */
	meta?: readonly ComponentChildren[];
	/** The person's own words (a cover note), quoted and clamped. */
	note?: string | null;
	foot?: ComponentChildren;
	/** A write on this card is in flight. */
	busy?: boolean;
	/** Open the in-place preview (plain left-click on the card). */
	onOpen?: () => void;
}

function bareHandle(handle: string): string {
	return handle.replace(/^@+/, "");
}

export function MemberCard(props: MemberCardProps): JSX.Element {
	const { person, role, viewer, presence } = props;
	const handle = person.handle ? bareHandle(person.handle) : null;
	const href = handle ? profileHref(handle) : null;
	const youMark = !!viewer && person.name !== "You";
	const meta = (props.meta ?? []).filter((fact) =>
		fact !== null && fact !== undefined && fact !== ""
	);

	function onLinkClick(event: MouseEvent): void {
		if (isModifiedClick(event) || !props.onOpen) return;
		event.preventDefault();
		props.onOpen();
	}

	return (
		<article
			class="mem-card"
			data-linked={href ? "true" : undefined}
			data-authority={role === "owner" || role === "client" ? "true" : undefined}
			data-viewer={viewer ? "true" : undefined}
			aria-busy={props.busy ? "true" : undefined}
			style={styleVars({ "--mem-accent": cardAccent(props.seed) })}
		>
			{href && (
				<a
					class="mem-card__link"
					href={href}
					aria-label={`${person.name} — profile`}
					onClick={onLinkClick}
				/>
			)}
			<div class="mem-card__banner" aria-hidden="true" />
			{props.status && <div class="mem-card__status">{props.status}</div>}
			{props.actions && <div class="mem-card__actions">{props.actions}</div>}

			<div class="mem-card__body">
				<div class="mem-card__identity">
					<span class="mem-card__avatar">
						{person.entity
							? (
								<Avatar
									image={person.avatar}
									label={person.name}
									alt=""
									size="xl"
									shape="square"
									class="mem-card__face"
								/>
							)
							: (
								<UserAvatar
									image={person.avatar}
									label={person.name}
									alt=""
									size="xl"
									class="mem-card__face"
								/>
							)}
						{presence && <PresenceDot presence={presence} />}
					</span>
					<span class="mem-card__name">
						<span class="mem-card__nametext">{person.name}</span>
						{role && <AuthorityMark role={role} />}
					</span>
					{(handle || youMark) && (
						<span class="mem-card__handle">
							{handle ? `@${handle}` : null}
							{handle && youMark ? " · " : null}
							{youMark ? "You" : null}
						</span>
					)}
				</div>

				{props.headline && <p class="mem-card__headline">{props.headline}</p>}

				{meta.length > 0 && (
					<p class="mem-card__meta">
						{meta.map((fact, i) => (
							<span class="mem-card__fact" key={i}>
								{i > 0 && <span class="mem-dot" aria-hidden="true">·</span>}
								{fact}
							</span>
						))}
					</p>
				)}

				{props.note && <p class="mem-card__note">{props.note}</p>}

				{props.foot && <div class="mem-card__foot">{props.foot}</div>}
			</div>
		</article>
	);
}
