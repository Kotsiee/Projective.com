import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Button, Checkbox, NumberInput, Textarea } from "@projective/ui/fields";
import { Dialog, Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	currencyExponent,
	formatMoney,
	toMajorUnits,
	toMinorUnits,
} from "@projective/types/finance";
import {
	HIRE_MESSAGE_MAX,
	HIRE_PRICE_LABEL,
	HIRE_PRICE_NOTE,
	type HireBrief,
	type HireInvitation,
	hireInvitationRefusal,
	hireInvitationTotalCents,
	type HireRefusal,
	type ProjectFormat,
	type ProjectStatus,
} from "@projective/types/projects";
import { HireService } from "@features/projects/core/HireService.ts";
import { type HireProject, hireProjectHref } from "../core/profile-model.ts";

/**
 * HireInviteModal — the invitation a client composes after picking one of their projects in the
 * hero's Hire popover: the project's overview, who is already on it and where, an intro message to
 * the seller, which stage(s) they are being invited onto, and the compensation offered for each.
 *
 * # The compensation fields follow the engagement's shape, not a control
 *
 * The brief arrives with a `pricingModel` derived server-side from the project's format and
 * structure (`hirePricingModelFor`), and the modal renders exactly the fields that model has: a
 * PIPELINE offers a per-ticket rate on each selected stage; a MULTI-STAGE ONE-OFF a whole fee per
 * selected stage; a SINGLE-STAGE ONE-OFF (or a Direct Deliverable) one task price and no stage list
 * at all — its one stage is the engagement, and a list of one with a checkbox would be a choice with
 * nothing to choose. Each field is SEEDED from the price the project already states for that stage,
 * so an untouched invitation offers the configured terms and every figure is an adjustment the
 * client made on purpose.
 *
 * # One rule, called twice
 *
 * The Send control is gated by `hireInvitationRefusal` — the SAME function the fat service runs on
 * the way in — so nothing this form lets through is refused for a rule it did not know. The one
 * check that lives only here is "a selected stage has no price yet": that is a state of the FORM
 * (an empty box), which the payload cannot even express, and it is resolved before a payload exists.
 *
 * Every figure typed here is an OFFER in the project's currency, entered in major units and stored
 * in minor units through the finance SSOT's exponent-aware converters, so a JP¥ offer is not
 * silently a hundred times larger than typed. The footer total is the SSOT's own sum.
 *
 * Rendered by the `ProfileHero` island beside the Hire popover; `project` is what the popover
 * picked, and `null` closes the modal. The brief is fetched on open — it is a modal, so the first
 * byte is not its job — and a failed fetch is a stated failure with a retry, never an empty form.
 * A sent invitation stays on screen as a success state naming what was offered and where the
 * invitation can be managed (the project's roster), so the modal does not vanish under the click
 * that sent it.
 */
export interface HireInviteModalProps {
	/** The project picked in the Hire popover, or `null` while closed. */
	project: Signal<HireProject | null>;
	/** The seller being invited. */
	seller: { name: string; handle: string; avatar: string | null };
	/** Fired once the invitation has been recorded, with the SSOT total offered (minor units). */
	onSent: (project: HireProject, totalCents: number, currency: string) => void;
}

/** The lifecycle word beside the project title — a state, so it earns its place (§B.11). */
const STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

/** The engagement's format as the overview names it. */
const FORMAT_LABEL: Record<ProjectFormat, string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
	session: "Session",
};

/** The role word beside a member's name. */
const ROLE_LABEL: Record<HireBrief["members"][number]["role"], string> = {
	client: "Client",
	owner: "Owner",
	admin: "Admin",
	manager: "Manager",
	freelancer: "Freelancer",
	member: "Team member",
	guest: "Guest",
};

/** The shared `NumberInput` configuration for an offer field — one currency box, three decisions. */
const MONEY_FIELD = {
	mode: "currency",
	step: 1,
	min: 0,
	enableIconScrub: true,
	scrubPixelsPerStep: 3,
} as const;

/** One minor unit in major units — the fine step Ctrl switches a money field to. */
function minorUnit(currency: string): number {
	return 1 / 10 ** currencyExponent(currency);
}

export function HireInviteModal(
	{ project, seller, onSent }: HireInviteModalProps,
): JSX.Element {
	const open = useSignal(false);
	const brief = useSignal<HireBrief | null>(null);
	const loadError = useSignal<string | null>(null);
	const loading = useSignal(false);
	const message = useSignal("");
	/** Which stages are selected, by id. */
	const selected = useSignal<Record<string, boolean>>({});
	/** The offered price per stage, in MINOR units; `null` is an empty box. */
	const prices = useSignal<Record<string, number | null>>({});
	const taskPrice = useSignal<number | null>(null);
	const sending = useSignal(false);
	/** The refusal shown after a Send attempt — never before, so a fresh form is not already wrong. */
	const refusal = useSignal<HireRefusal | null>(null);
	/** The recorded invitation, once sent — the success state renders from it. */
	const sent = useSignal<{ totalCents: number; currency: string; stageCount: number } | null>(null);
	const attempted = useSignal(false);
	const firstFieldRef = useRef<HTMLDivElement>(null);

	const picked = project.value;

	async function load(slug: string): Promise<void> {
		loading.value = true;
		loadError.value = null;
		brief.value = null;
		const res = await HireService.brief(slug);
		// A second project may have been picked while this one was in flight.
		if (project.value?.slug !== slug) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ?? "Couldn't load this project.";
			return;
		}
		const next = res.data.brief;
		brief.value = next;
		// Seed the form from the project's own terms: every stage selected, at its configured price.
		const sel: Record<string, boolean> = {};
		const pr: Record<string, number | null> = {};
		for (const stage of next.stages) {
			sel[stage.id] = true;
			pr[stage.id] = stage.unitPriceCents;
		}
		selected.value = sel;
		prices.value = pr;
		taskPrice.value = next.taskPriceCents;
	}

	// Opening: a picked project opens the modal and fetches its brief; clearing it closes the modal.
	useEffect(() => {
		if (!picked) {
			open.value = false;
			return;
		}
		open.value = true;
		message.value = "";
		refusal.value = null;
		attempted.value = false;
		sent.value = null;
		void load(picked.slug);
	}, [picked?.slug]);

	function close(): void {
		project.value = null;
	}

	const currency = brief.value?.currency ?? "USD";
	const exponent = currencyExponent(currency);

	/** The offer as the SSOT shapes it, or `null` while a selected stage still has an empty box. */
	function draft(): { input: HireInvitation } | { unpriced: string } | null {
		const b = brief.value;
		if (!b || !picked) return null;
		if (b.pricingModel === "task") {
			return {
				input: {
					projectId: b.projectId,
					handle: seller.handle,
					message: message.value.trim(),
					stages: [],
					taskPriceCents: taskPrice.value,
				},
			};
		}
		const stages: HireInvitation["stages"] = [];
		for (const stage of b.stages) {
			if (!selected.value[stage.id]) continue;
			const price = prices.value[stage.id] ?? null;
			if (price === null) return { unpriced: stage.name };
			stages.push({ stageId: stage.id, priceCents: price });
		}
		return {
			input: {
				projectId: b.projectId,
				handle: seller.handle,
				message: message.value.trim(),
				stages,
				taskPriceCents: null,
			},
		};
	}

	/** The reason the form cannot be sent right now, or `null`. */
	function currentRefusal(): HireRefusal | null {
		const b = brief.value;
		const d = draft();
		if (!b || !d) return null;
		if ("unpriced" in d) {
			return {
				message: `Set a price for ${d.unpriced} before sending.`,
				errors: { stages: "unpriced" },
			};
		}
		return hireInvitationRefusal(b, d.input);
	}

	async function send(): Promise<void> {
		const b = brief.value;
		if (!b || !picked || sending.value) return;
		attempted.value = true;
		const blocked = currentRefusal();
		if (blocked) {
			refusal.value = blocked;
			return;
		}
		const d = draft();
		if (!d || "unpriced" in d) return;
		sending.value = true;
		refusal.value = null;
		const res = await HireService.invite(d.input);
		sending.value = false;
		if (!res.ok || !res.data) {
			refusal.value = {
				message: res.message ?? "The invitation could not be sent.",
				errors: res.errors ?? {},
			};
			return;
		}
		sent.value = {
			totalCents: res.data.total,
			currency: b.currency,
			stageCount: res.data.invites.length,
		};
		onSent(picked, res.data.total, b.currency);
	}

	const b = brief.value;
	const d = b ? draft() : null;
	const total = d && !("unpriced" in d) ? hireInvitationTotalCents(d.input) : null;
	const selectedCount = b ? b.stages.filter((s) => selected.value[s.id]).length : 0;
	const blocked = attempted.value ? currentRefusal() : null;
	const stagesRefused = blocked?.errors.stages !== undefined;
	const taskRefused = blocked?.errors.taskPriceCents !== undefined;
	const title = picked ? `Invite ${seller.name} to ${picked.title}` : "Invite";

	const footer = sent.value
		? (
			<div class="pf-hiremodal__foot pf-hiremodal__foot--sent">
				<div class="pf-hiremodal__actions">
					<Button variant="filled" label="Done" onClick={close} />
				</div>
			</div>
		)
		: (
			<div class="pf-hiremodal__foot">
				<div class="pf-hiremodal__total" aria-live="polite">
					{b && total !== null
						? (
							<>
								<span class="pf-hiremodal__total-label">
									{b.pricingModel === "per_ticket_stage"
										? `Per ticket · ${selectedCount} ${selectedCount === 1 ? "stage" : "stages"}`
										: b.pricingModel === "per_stage"
										? `Offer · ${selectedCount} ${selectedCount === 1 ? "stage" : "stages"}`
										: "Offer"}
								</span>
								<span class="pf-hiremodal__total-figure">{formatMoney(total, b.currency)}</span>
							</>
						)
						: null}
				</div>
				<div class="pf-hiremodal__actions">
					<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
					<Button
						variant="filled"
						label={sending.value ? "Sending…" : "Send invitation"}
						disabled={!b || loading.value || sending.value}
						loading={sending.value}
						onClick={() => void send()}
					/>
				</div>
			</div>
		);

	return (
		<Dialog
			visible={open}
			header={title}
			width="40rem"
			class="pf-hiremodal"
			footer={footer}
			initialFocusRef={firstFieldRef}
			onVisibleChange={(v) => {
				if (!v) close();
			}}
		>
			{loading.value && <p class="pf-hiremodal__hint" role="status">Loading the project…</p>}

			{!loading.value && loadError.value && (
				<div class="pf-hiremodal__failed" role="alert">
					<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
					<Button
						variant="outlined"
						severity="secondary"
						size="sm"
						label="Try again"
						onClick={() => picked && void load(picked.slug)}
					/>
				</div>
			)}

			{sent.value && picked && (
				<div class="pf-hiremodal__sent" role="status">
					<span class="pf-hiremodal__sent-mark" aria-hidden="true">
						<Icon name="check" size="md" />
					</span>
					<h3 class="pf-hiremodal__sent-title">Invitation sent to {seller.name}</h3>
					<p class="pf-hiremodal__sent-body">
						{sent.value.stageCount > 1
							? `${sent.value.stageCount} stages of ${picked.title}, `
							: `${picked.title}, `}
						{formatMoney(sent.value.totalCents, sent.value.currency)}{" "}
						offered. They will see the invitation and your message; you can manage it from the
						project’s roster.
					</p>
					<a class="pf-hiremodal__sent-link" href={hireProjectHref(picked)}>
						Open the project roster
					</a>
				</div>
			)}

			{b && !loading.value && !sent.value && (
				<div class="pf-hiremodal__body">
					{/* Project overview — prose on the surface, one hairline below (§B.4). */}
					<section class="pf-hiremodal__section" aria-labelledby="pf-hire-overview">
						<p class="pf-hiremodal__eyebrow" id="pf-hire-overview">Project</p>
						<h3 class="pf-hiremodal__title">
							<span class="pf-hiremodal__title-text">{b.title}</span>
							<span class="pf-hiremodal__status" data-status={b.status}>
								{STATUS_LABEL[b.status]}
							</span>
						</h3>
						<p class="pf-hiremodal__meta">
							<span>{FORMAT_LABEL[b.format]}</span>
							<span class="pf-hiremodal__dot" aria-hidden="true">·</span>
							<span>
								{b.pricingModel === "task"
									? "Single stage"
									: `${b.stages.length} ${b.stages.length === 1 ? "stage" : "stages"}`}
							</span>
							<span class="pf-hiremodal__dot" aria-hidden="true">·</span>
							<span>{b.currency}</span>
						</p>
						{b.summary
							? <p class="pf-hiremodal__summary">{b.summary}</p>
							: (
								<p class="pf-hiremodal__summary pf-hiremodal__summary--empty">
									No description yet.
								</p>
							)}
					</section>

					{/* Existing members and where they sit. */}
					<section class="pf-hiremodal__section" aria-labelledby="pf-hire-team">
						<p class="pf-hiremodal__eyebrow" id="pf-hire-team">
							Team{b.members.length > 0 ? ` · ${b.members.length}` : ""}
						</p>
						{b.members.length === 0
							? <p class="pf-hiremodal__hint">Nobody has joined this project yet.</p>
							: (
								<ul class="pf-hiremodal__members" role="list">
									{b.members.map((m) => (
										<li key={m.id} class="pf-hiremodal__member">
											<Avatar
												image={m.party.avatar ?? undefined}
												label={m.party.name}
												size={32}
												shape="circle"
											/>
											<span class="pf-hiremodal__member-text">
												<span class="pf-hiremodal__member-name">{m.party.name}</span>
												<span class="pf-hiremodal__member-meta">
													<span>{ROLE_LABEL[m.role]}</span>
													{m.assignedStages.length > 0 && (
														<>
															<span class="pf-hiremodal__dot" aria-hidden="true">·</span>
															<span>{m.assignedStages.join(", ")}</span>
														</>
													)}
												</span>
											</span>
										</li>
									))}
								</ul>
							)}
					</section>

					{/* The intro message. */}
					<section class="pf-hiremodal__section" aria-labelledby="pf-hire-message-label">
						<div ref={firstFieldRef} tabIndex={-1} class="pf-hiremodal__field">
							<label class="pf-hiremodal__label" id="pf-hire-message-label" for="pf-hire-message">
								Message to {seller.name}
							</label>
							<Textarea
								id="pf-hire-message"
								fluid
								autoResize
								rows={3}
								maxRows={8}
								maxLength={HIRE_MESSAGE_MAX}
								placeholder={`Tell ${seller.name} what you need and why you thought of them…`}
								value={message}
							/>
							<p class="pf-hiremodal__note">
								Sent with the invitation. It also opens your conversation with {seller.name}.
							</p>
						</div>
					</section>

					{/* Stage selection + compensation, by pricing model. */}
					<section class="pf-hiremodal__section" aria-labelledby="pf-hire-stages">
						<p class="pf-hiremodal__eyebrow" id="pf-hire-stages">
							{b.pricingModel === "task" ? "Compensation" : "Stages"}
						</p>
						<p class="pf-hiremodal__note">{HIRE_PRICE_NOTE[b.pricingModel]}</p>

						{/* The task box is keyed per project: the control seeds its own state ONCE from a raw value. */}
						{b.pricingModel === "task"
							? (
								<div class="pf-hiremodal__field pf-hiremodal__field--task" key={b.projectId}>
									<label class="pf-hiremodal__label" for="pf-hire-task-price">
										{HIRE_PRICE_LABEL.task}
									</label>
									<NumberInput
										{...MONEY_FIELD}
										id="pf-hire-task-price"
										value={toMajorUnits(taskPrice.value, currency)}
										onValueChange={(v: number | null) => {
											taskPrice.value = toMinorUnits(v, currency);
										}}
										currency={currency}
										maxFractionDigits={exponent}
										minFractionDigits={exponent}
										precisionStep={minorUnit(currency)}
										status={taskRefused ? "invalid" : "default"}
										aria-describedby="pf-hire-stages"
									/>
								</div>
							)
							: (
								<ul
									class="pf-hiremodal__stages"
									role="list"
									data-refused={stagesRefused ? "true" : undefined}
								>
									{b.stages.map((stage) => {
										const on = !!selected.value[stage.id];
										const priceId = `pf-hire-price-${stage.id}`;
										// Keyed per project AND stage: the checkbox and the price box seed their own
										// state ONCE from a raw value, so a second project's brief must remount them.
										return (
											<li
												key={`${b.projectId}:${stage.id}`}
												class="pf-hiremodal__stage"
												data-selected={on ? "true" : undefined}
											>
												<div class="pf-hiremodal__stage-pick">
													<Checkbox
														label={stage.name}
														value={on}
														onValueChange={(next: boolean) => {
															selected.value = { ...selected.value, [stage.id]: next };
														}}
													/>
													<span class="pf-hiremodal__stage-meta">
														<span>Stage {stage.order + 1}</span>
														{stage.memberNames.length > 0 && (
															<>
																<span class="pf-hiremodal__dot" aria-hidden="true">·</span>
																<span>{stage.memberNames.join(", ")}</span>
															</>
														)}
														{stage.memberNames.length === 0 && stage.onboardedCount === 0 && (
															<>
																<span class="pf-hiremodal__dot" aria-hidden="true">·</span>
																<span>Unstaffed</span>
															</>
														)}
													</span>
													{stage.summary && (
														<span class="pf-hiremodal__stage-summary">{stage.summary}</span>
													)}
												</div>
												<div class="pf-hiremodal__stage-price">
													<label class="pf-hiremodal__label" for={priceId}>
														{HIRE_PRICE_LABEL[b.pricingModel]}
													</label>
													<NumberInput
														{...MONEY_FIELD}
														id={priceId}
														size="sm"
														value={toMajorUnits(prices.value[stage.id] ?? null, currency)}
														onValueChange={(v: number | null) => {
															prices.value = {
																...prices.value,
																[stage.id]: toMinorUnits(v, currency),
															};
														}}
														currency={currency}
														maxFractionDigits={exponent}
														minFractionDigits={exponent}
														precisionStep={minorUnit(currency)}
														disabled={!on}
														status={on && attempted.value && prices.value[stage.id] == null
															? "invalid"
															: "default"}
													/>
												</div>
											</li>
										);
									})}
								</ul>
							)}
					</section>

					{refusal.value && (
						<div class="pf-hiremodal__refusal">
							<Message
								severity="danger"
								variant="subtle"
								size="sm"
								closable
								onClose={() => (refusal.value = null)}
							>
								{refusal.value.message}
							</Message>
						</div>
					)}

					<p class="pf-hiremodal__disclosure">
						<Icon name="info" size="xs" />
						<span>
							Nothing is charged now. Prices are what {seller.name}{" "}
							will see in the invitation; escrow is funded when work is claimed.
						</span>
					</p>
				</div>
			)}
		</Dialog>
	);
}
