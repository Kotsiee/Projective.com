import type { JSX } from "preact";
import { Avatar, Tag } from "@projective/ui/display";
import { Button, type Severity } from "@projective/ui/fields";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import { profileHref } from "@web/features/projects/core/routing.ts";
import type {
	ContextAction,
	ContextActionKind,
	ConversationContext,
	ConversationCounterpart,
	ConversationEngagement,
	EngagementStatus,
} from "../types/messaging-types.ts";

/**
 * ConversationContextDrawer — what a DM is about, beside (or over) the thread: the counterpart with
 * their Standing, the request between the two (scope · questionnaire · milestones as unboxed hairline
 * rows), any earlier requests, and the action rig the server derived for the viewer. Presentational;
 * the {@link ConversationContextPanel} island owns the data and runs the actions.
 */

// #region Props
export interface ConversationContextDrawerProps {
	context: ConversationContext;
	/** The action in flight, if any — every control holds while one runs. */
	busy: ContextActionKind | null;
	error: string | null;
	onAction: (action: ContextAction) => void;
}
// #endregion

const STATUS_LABEL: Record<EngagementStatus, string> = {
	pending: "Pending",
	accepted: "Accepted",
	declined: "Declined",
	expired: "Expired",
	rejected: "Not selected",
	withdrawn: "Withdrawn",
};

const STATUS_SEVERITY: Record<EngagementStatus, Severity> = {
	pending: "warning",
	accepted: "success",
	declined: "danger",
	expired: "secondary",
	rejected: "secondary",
	withdrawn: "secondary",
};

function requestTitle(e: ConversationEngagement): string {
	if (e.kind === "invitation") {
		return e.direction === "received" ? "Invitation to you" : "Your invitation";
	}
	return e.direction === "received" ? "Application to you" : "Your application";
}

function middot(parts: (string | null | undefined)[]): string {
	return parts.filter((p): p is string => !!p).join(" · ");
}

function Counterpart({ person }: { person: ConversationCounterpart }): JSX.Element {
	const handle = person.handle ? person.handle.replace(/^@/, "") : null;
	return (
		<section class="msg-ctx__who" aria-label={`About ${person.name}`}>
			<Avatar
				image={person.avatar ?? undefined}
				fallbackImage={DEFAULT_AVATAR_URL}
				label={person.name}
				size={48}
				shape="circle"
			/>
			<div class="msg-ctx__identity">
				<p class="msg-ctx__name">{person.name}</p>
				<p class="msg-ctx__meta">
					{handle && <a class="msg-ctx__link" href={profileHref(handle)}>@{handle}</a>}
					{handle && person.standing && <span aria-hidden="true">·</span>}
					{person.standing && <span>Standing · {person.standing.label}</span>}
				</p>
			</div>
		</section>
	);
}

function Request({ engagement: e }: { engagement: ConversationEngagement }): JSX.Element {
	const terms = middot([
		e.stageName,
		e.roleTitle,
		e.priceLabel ?? (e.placeholder ? "Terms set when published" : null),
	]);
	return (
		<>
			<section class="msg-ctx__section" aria-label={requestTitle(e)}>
				<div class="msg-ctx__head">
					<h3 class="msg-ctx__heading">{requestTitle(e)}</h3>
					<Tag
						value={STATUS_LABEL[e.status]}
						severity={STATUS_SEVERITY[e.status]}
						variant="subtle"
						rounded
					/>
				</div>
				<p class="msg-ctx__project">
					{e.projectHref
						? <a class="msg-ctx__link" href={e.projectHref}>{e.projectTitle}</a>
						: e.projectTitle}
				</p>
				{terms && <p class="msg-ctx__meta">{terms}</p>}
				<p class="msg-ctx__meta">{middot([e.sentLabel, e.expiresLabel])}</p>
				{e.message && <p class="msg-ctx__note">{e.message}</p>}
			</section>

			{e.summary && (
				<section class="msg-ctx__section" aria-label="Scope">
					<h3 class="msg-ctx__heading">Scope</h3>
					<p class="msg-ctx__body">{e.summary}</p>
				</section>
			)}

			{e.answers.length > 0 && (
				<section class="msg-ctx__section" aria-label="Questionnaire">
					<h3 class="msg-ctx__heading">Questionnaire</h3>
					<dl class="msg-ctx__rows">
						{e.answers.map((a, i) => (
							<div class="msg-ctx__row" key={i}>
								<dt class="msg-ctx__label">{a.label}</dt>
								<dd class="msg-ctx__value">{a.value || "Not answered"}</dd>
							</div>
						))}
					</dl>
				</section>
			)}

			{e.milestones.length > 0 && (
				<section class="msg-ctx__section" aria-label="Milestones">
					<h3 class="msg-ctx__heading">Milestones</h3>
					<ol class="msg-ctx__rows">
						{e.milestones.map((m) => (
							<li
								class="msg-ctx__row"
								key={m.stageId}
								data-current={m.current ? "true" : undefined}
							>
								<span class="msg-ctx__row-head">
									<span class="msg-ctx__row-title">{m.name}</span>
									{m.priceLabel && <span class="msg-ctx__figure">{m.priceLabel}</span>}
								</span>
								{m.current && <span class="msg-ctx__meta">This request</span>}
								{m.detail && <span class="msg-ctx__value">{m.detail}</span>}
							</li>
						))}
					</ol>
				</section>
			)}
		</>
	);
}

function Rig(props: ConversationContextDrawerProps): JSX.Element {
	return (
		<div class="msg-ctx__rig">
			{props.error && <p class="msg-ctx__error" role="alert">{props.error}</p>}
			{props.context.actions.map((a) => (
				<div class="msg-ctx__act" key={a.kind}>
					{a.kind === "fund_escrow" && a.href
						? (
							<a
								class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--fluid msg-ctx__fund"
								href={a.href}
							>
								<span class="ui-button__label">{a.label}</span>
							</a>
						)
						: (
							<Button
								label={a.label}
								severity={a.kind === "decline_invitation" ? "secondary" : "primary"}
								variant={a.kind === "decline_invitation" ? "outlined" : "filled"}
								fluid
								loading={props.busy === a.kind}
								disabled={props.busy !== null && props.busy !== a.kind}
								onClick={() => props.onAction(a)}
							/>
						)}
					{a.note && <p class="msg-ctx__meta">{a.note}</p>}
				</div>
			))}
		</div>
	);
}

export function ConversationContextDrawer(props: ConversationContextDrawerProps): JSX.Element {
	const { context } = props;
	const [current, ...earlier] = context.engagements;
	return (
		<div class="msg-ctx">
			<div class="msg-ctx__scroll">
				{context.counterpart && <Counterpart person={context.counterpart} />}
				{current
					? <Request engagement={current} />
					: <p class="msg-ctx__empty">No requests between you yet.</p>}
				{earlier.length > 0 && (
					<section class="msg-ctx__section" aria-label="Earlier requests">
						<h3 class="msg-ctx__heading">Earlier requests</h3>
						<ul class="msg-ctx__rows">
							{earlier.map((e) => (
								<li class="msg-ctx__row" key={e.id}>
									<span class="msg-ctx__row-head">
										<span class="msg-ctx__row-title">{e.projectTitle}</span>
										<span class="msg-ctx__meta">{STATUS_LABEL[e.status]}</span>
									</span>
									<span class="msg-ctx__meta">
										{middot([requestTitle(e), e.stageName, e.sentLabel])}
									</span>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
			{(context.actions.length > 0 || props.error) && <Rig {...props} />}
		</div>
	);
}
