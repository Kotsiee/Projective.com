import type { JSX } from "preact";
import "../styles/dev-context.css";
import type { UserContext } from "@projective/types/auth";
import {
	ACCOUNT_TYPES,
	applyDevContext,
	DEV_ASSET_VISIBILITIES,
	DEV_BASKET_OWNERS,
	DEV_BILLING_CONTEXTS,
	DEV_BUYER_DETAILS,
	DEV_CONFERENCING,
	DEV_CONNECTION_STATES,
	DEV_DEDUP_STATES,
	DEV_DISPLAY_CURRENCIES,
	DEV_CALL_OFFERS,
	DEV_COHORT_CAPACITIES,
	DEV_EVENT_RESCHEDULES,
	DEV_EVENT_RSVPS,
	DEV_EVENT_SEATS,
	DEV_FULFILMENT_MIXES,
	DEV_INVOICING_MODES,
	DEV_LAYOUT_DIRECTIONS,
	DEV_LINK_SCANS,
	DEV_MEMBER_ROLES,
	DEV_MEMBERSHIP_STATES,
	DEV_MESSAGING_ROLES,
	DEV_MIC_PERMISSIONS,
	DEV_PAYMENT_PROVIDERS,
	DEV_PROJECT_TYPES,
	DEV_ROLES,
	DEV_ROSTER_STATES,
	DEV_PIPELINE_DRAFTS,
	DEV_SAVED_CARDS,
	DEV_SLOT_AVAILABILITIES,
	DEV_SERVICE_TYPES,
	DEV_SESSION_BOOKINGS,
	DEV_SPEND_LIMITS,
	DEV_STAGE_ASSIGNMENTS,
	DEV_STORAGE_PROVIDERS,
	DEV_STORAGE_QUOTAS,
	DEV_SUBMISSION_STATES,
	DEV_WALLET_COVERAGES,
	DEV_WALLET_FUND_MIXES,
	DEV_WALLET_KYCS,
	DEV_WALLET_SMOOTHERS,
	DEV_WALLET_STANDINGS,
	DEV_WALLET_VAULT_ROLES,
	DEV_WORKSPACE_KINDS,
	DEV_WORKSPACE_ROLES,
	DEV_WORKSPACE_VERIFICATIONS,
	type DevOption,
	devOverrides,
	patchDevContext,
	resetDevContext,
	setDevActiveEntity,
	setDevEnabled,
} from "../core/dev-context.ts";
import { openMoneyFlow } from "@features/checkout/core/money-flow-state.ts";

// #region Props
/** Props for {@link DevContextPanel}. */
export interface DevContextPanelProps {
	/** The developer's real (hydrated) context, so the panel can show the effective, overridden result. */
	baseContext?: UserContext;
}
// #endregion

/** A labelled row wrapping a segmented control or toggle. */
function Field(props: { label: string; hint?: string; children: JSX.Element }): JSX.Element {
	return (
		<div class="dev-ctx__field">
			<div class="dev-ctx__label">
				<span>{props.label}</span>
				{props.hint && <span class="dev-ctx__hint">{props.hint}</span>}
			</div>
			{props.children}
		</div>
	);
}

/** A segmented single-choice control. */
function Segment<T extends string>(props: {
	options: ReadonlyArray<DevOption<T>>;
	value: T;
	disabled?: boolean;
	onChange: (value: T) => void;
	name: string;
}): JSX.Element {
	return (
		<div class="dev-ctx__segment" role="radiogroup" aria-label={props.name}>
			{props.options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					role="radio"
					aria-checked={props.value === opt.value}
					class="dev-ctx__seg"
					data-active={props.value === opt.value}
					disabled={props.disabled}
					onClick={() => props.onChange(opt.value)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

/**
 * DevContextPanel — the body of the Context Switcher window. Renders the master simulation switch and,
 * when it is on, the persona/account-type, ownership, and role controls, plus a live summary of the
 * effective (overridden) {@link UserContext}. Reads the {@link devOverrides} signal directly, so every
 * control reflects the shared store; changes persist + emit through the store's setters.
 *
 * Dev-only by construction (rendered inside the build-excluded Dev Tools island).
 */
export function DevContextPanel(props: DevContextPanelProps): JSX.Element {
	const o = devOverrides.value;
	const effective = props.baseContext ? applyDevContext(props.baseContext) : undefined;

	return (
		<div class="dev-ctx">
			<div class="dev-ctx__master">
				<div class="dev-ctx__master-copy">
					<strong>Simulate context</strong>
					<span class="dev-ctx__hint">
						{o.enabled
							? "Overriding your real session (chrome only)."
							: "Off — using your real session."}
					</span>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={o.enabled}
					class="dev-ctx__switch"
					data-on={o.enabled}
					onClick={() => setDevEnabled(!o.enabled)}
				>
					<span class="dev-ctx__switch-track">
						<span class="dev-ctx__switch-thumb" />
					</span>
					<span class="dev-ctx__switch-text">{o.enabled ? "On" : "Off"}</span>
				</button>
			</div>

			<div class="dev-ctx__controls" data-disabled={!o.enabled} aria-disabled={!o.enabled}>
				<Field label="Account type">
					<Segment
						name="Account type"
						options={ACCOUNT_TYPES}
						value={o.accountType}
						disabled={!o.enabled}
						onChange={(accountType) => patchDevContext({ accountType })}
					/>
				</Field>

				<Field label="Active entity" hint="scope id / @handle">
					<input
						type="text"
						class="dev-ctx__input"
						placeholder={o.accountType === "business"
							? "e.g. b_monarch (auto: first business)"
							: o.accountType === "team"
							? "e.g. t_northwind (auto: first team)"
							: "auto — derived from persona"}
						value={o.activeEntity}
						disabled={!o.enabled}
						aria-label="Active entity"
						onInput={(e) => setDevActiveEntity((e.target as HTMLInputElement).value)}
					/>
				</Field>

				<Field label="Entity ownership" hint="isOwner">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Entity ownership">
						<button
							type="button"
							role="radio"
							aria-checked={!o.isOwner}
							class="dev-ctx__seg"
							data-active={!o.isOwner}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ isOwner: false })}
						>
							Viewer
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={o.isOwner}
							class="dev-ctx__seg"
							data-active={o.isOwner}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ isOwner: true })}
						>
							Owner
						</button>
					</div>
				</Field>

				<Field label="Team / business role">
					<Segment
						name="Role"
						options={DEV_ROLES}
						value={o.role}
						disabled={!o.enabled}
						onChange={(role) => patchDevContext({ role })}
					/>
				</Field>

				<div class="dev-ctx__grouphead">Session services</div>

				<Field label="Service type" hint="standard / session">
					<Segment
						name="Service type"
						options={DEV_SERVICE_TYPES}
						value={o.serviceType}
						disabled={!o.enabled}
						onChange={(serviceType) => patchDevContext({ serviceType })}
					/>
				</Field>

				<Field label="Booking status" hint="next session">
					<Segment
						name="Booking status"
						options={DEV_SESSION_BOOKINGS}
						value={o.sessionBookingStatus}
						disabled={!o.enabled || o.serviceType === "standard_project"}
						onChange={(sessionBookingStatus) => patchDevContext({ sessionBookingStatus })}
					/>
				</Field>

				<Field label="Sub-group assignment" hint="group session">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Sub-group assignment">
						<button
							type="button"
							role="radio"
							aria-checked={!o.multiSubGroup}
							class="dev-ctx__seg"
							data-active={!o.multiSubGroup}
							disabled={!o.enabled || o.serviceType !== "group_session"}
							onClick={() => patchDevContext({ multiSubGroup: false })}
						>
							Single
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={o.multiSubGroup}
							class="dev-ctx__seg"
							data-active={o.multiSubGroup}
							disabled={!o.enabled || o.serviceType !== "group_session"}
							onClick={() => patchDevContext({ multiSubGroup: true })}
						>
							Multiple
						</button>
					</div>
				</Field>

				<div class="dev-ctx__grouphead">Submissions workflow</div>

				<Field label="Project type" hint="tickets vs one-off">
					<Segment
						name="Project type"
						options={DEV_PROJECT_TYPES}
						value={o.projectType}
						disabled={!o.enabled}
						onChange={(projectType) => patchDevContext({ projectType })}
					/>
				</Field>

				<Field label="Stage assignment" hint="freelancer">
					<Segment
						name="Stage assignment"
						options={DEV_STAGE_ASSIGNMENTS}
						value={o.stageAssignment}
						disabled={!o.enabled}
						onChange={(stageAssignment) => patchDevContext({ stageAssignment })}
					/>
				</Field>

				<Field label="Submission state" hint="active unit">
					<Segment
						name="Submission state"
						options={DEV_SUBMISSION_STATES}
						value={o.submissionState}
						disabled={!o.enabled}
						onChange={(submissionState) => patchDevContext({ submissionState })}
					/>
				</Field>

				<Field label="Stage / ticket tasks" hint="hasTasks">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Stage / ticket tasks">
						<button
							type="button"
							role="radio"
							aria-checked={o.hasTasks}
							class="dev-ctx__seg"
							data-active={o.hasTasks}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasTasks: true })}
						>
							Has tasks
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={!o.hasTasks}
							class="dev-ctx__seg"
							data-active={!o.hasTasks}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasTasks: false })}
						>
							None
						</button>
					</div>
				</Field>

				<div class="dev-ctx__grouphead">Members tab</div>

				<Field label="Acting member" hint="viewer role">
					<Segment
						name="Acting member"
						options={DEV_MEMBER_ROLES}
						value={o.memberRole}
						disabled={!o.enabled}
						onChange={(memberRole) => patchDevContext({ memberRole })}
					/>
				</Field>

				<Field label="Pending invitations" hint="hasPendingInvites">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Pending invitations">
						<button
							type="button"
							role="radio"
							aria-checked={o.hasPendingInvites}
							class="dev-ctx__seg"
							data-active={o.hasPendingInvites}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasPendingInvites: true })}
						>
							Has invites
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={!o.hasPendingInvites}
							class="dev-ctx__seg"
							data-active={!o.hasPendingInvites}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasPendingInvites: false })}
						>
							None
						</button>
					</div>
				</Field>

				<div class="dev-ctx__grouphead">Messaging</div>

				<Field label="Inbox view" hint="filter set">
					<Segment
						name="Inbox view"
						options={DEV_MESSAGING_ROLES}
						value={o.messagingRole}
						disabled={!o.enabled}
						onChange={(messagingRole) => patchDevContext({ messagingRole })}
					/>
				</Field>

				<Field label="Microphone" hint="voice capture">
					<Segment
						name="Microphone"
						options={DEV_MIC_PERMISSIONS}
						value={o.micPermission}
						disabled={!o.enabled}
						onChange={(micPermission) => patchDevContext({ micPermission })}
					/>
				</Field>

				<div class="dev-ctx__grouphead">Service booking</div>

				<Field label="Discovery calls" hint="Contact Me menu">
					<Segment
						name="Discovery calls"
						options={DEV_CALL_OFFERS}
						value={o.callOffer}
						disabled={!o.enabled}
						onChange={(callOffer) => patchDevContext({ callOffer })}
					/>
				</Field>

				<Field label="Cohort seats" hint="capacity gate">
					<Segment
						name="Cohort seats"
						options={DEV_COHORT_CAPACITIES}
						value={o.cohortCapacity}
						disabled={!o.enabled}
						onChange={(cohortCapacity) => patchDevContext({ cohortCapacity })}
					/>
				</Field>

				<Field label="Pipeline draft" hint="Add ⇄ Open project">
					<Segment
						name="Pipeline draft"
						options={DEV_PIPELINE_DRAFTS}
						value={o.pipelineDraft}
						disabled={!o.enabled}
						onChange={(pipelineDraft) => patchDevContext({ pipelineDraft })}
					/>
				</Field>

				<Field label="Availability" hint="slot picker">
					<Segment
						name="Availability"
						options={DEV_SLOT_AVAILABILITIES}
						value={o.slotAvailability}
						disabled={!o.enabled}
						onChange={(slotAvailability) => patchDevContext({ slotAvailability })}
					/>
				</Field>

				<div class="dev-ctx__grouphead">Workspaces</div>

				<Field label="Entity kind" hint="team / business">
					<Segment
						name="Entity kind"
						options={DEV_WORKSPACE_KINDS}
						value={o.workspaceKind}
						disabled={!o.enabled}
						onChange={(workspaceKind) => patchDevContext({ workspaceKind })}
					/>
				</Field>

				<Field label="Entity role" hint="capability gate">
					<Segment
						name="Entity role"
						options={DEV_WORKSPACE_ROLES}
						value={o.workspaceRole}
						disabled={!o.enabled}
						onChange={(workspaceRole) => patchDevContext({ workspaceRole })}
					/>
				</Field>

				<Field label="Membership" hint="active / pending">
					<Segment
						name="Membership state"
						options={DEV_MEMBERSHIP_STATES}
						value={o.membershipState}
						disabled={!o.enabled}
						onChange={(membershipState) => patchDevContext({ membershipState })}
					/>
				</Field>

				<Field label="Entity verification" hint="KYC / KYB">
					<Segment
						name="Entity verification"
						options={DEV_WORKSPACE_VERIFICATIONS}
						value={o.workspaceVerification}
						disabled={!o.enabled}
						onChange={(workspaceVerification) => patchDevContext({ workspaceVerification })}
					/>
				</Field>

				<Field label="Roster" hint="populated / single / empty">
					<Segment
						name="Roster state"
						options={DEV_ROSTER_STATES}
						value={o.rosterState}
						disabled={!o.enabled}
						onChange={(rosterState) => patchDevContext({ rosterState })}
					/>
				</Field>

				<Field label="Acting context" hint="acting as the entity">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Acting context">
						<button
							type="button"
							role="radio"
							aria-checked={o.actingContext}
							class="dev-ctx__seg"
							data-active={o.actingContext}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ actingContext: true })}
						>
							Acting as
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={!o.actingContext}
							class="dev-ctx__seg"
							data-active={!o.actingContext}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ actingContext: false })}
						>
							Personal
						</button>
					</div>
				</Field>

				<div class="dev-ctx__grouphead">Wallet / Finance</div>

				<Field label="Vault role" hint="capability">
					<Segment
						name="Vault role"
						options={DEV_WALLET_VAULT_ROLES}
						value={o.walletVaultRole}
						disabled={!o.enabled}
						onChange={(walletVaultRole) => patchDevContext({ walletVaultRole })}
					/>
				</Field>

				<Field label="Verification" hint="KYC state">
					<Segment
						name="Verification"
						options={DEV_WALLET_KYCS}
						value={o.walletKyc}
						disabled={!o.enabled}
						onChange={(walletKyc) => patchDevContext({ walletKyc })}
					/>
				</Field>

				<Field label="Income Smoother" hint="eligibility">
					<Segment
						name="Income Smoother"
						options={DEV_WALLET_SMOOTHERS}
						value={o.walletSmoother}
						disabled={!o.enabled}
						onChange={(walletSmoother) => patchDevContext({ walletSmoother })}
					/>
				</Field>

				<Field label="Fund states" hint="balance mix">
					<Segment
						name="Fund states"
						options={DEV_WALLET_FUND_MIXES}
						value={o.walletFundMix}
						disabled={!o.enabled}
						onChange={(walletFundMix) => patchDevContext({ walletFundMix })}
					/>
				</Field>

				<Field label="Standing" hint="earned rung">
					<Segment
						name="Standing"
						options={DEV_WALLET_STANDINGS}
						value={o.walletStanding}
						disabled={!o.enabled}
						onChange={(walletStanding) => patchDevContext({ walletStanding })}
					/>
				</Field>

				<Field label="Display currency" hint="Intl format">
					<Segment
						name="Display currency"
						options={DEV_DISPLAY_CURRENCIES}
						value={o.displayCurrency}
						disabled={!o.enabled}
						onChange={(displayCurrency) => patchDevContext({ displayCurrency })}
					/>
				</Field>

				<Field label="Direction" hint="LtR / RtL">
					<Segment
						name="Direction"
						options={DEV_LAYOUT_DIRECTIONS}
						value={o.layoutDirection}
						disabled={!o.enabled}
						onChange={(layoutDirection) => patchDevContext({ layoutDirection })}
					/>
				</Field>
			</div>

			<div class="dev-ctx__group">
				<div class="dev-ctx__grouphead">Files / Storage</div>

				<Field label="Cloud provider" hint="connected drive">
					<Segment
						name="Cloud provider"
						options={DEV_STORAGE_PROVIDERS}
						value={o.storageProvider}
						disabled={!o.enabled}
						onChange={(storageProvider) => patchDevContext({ storageProvider })}
					/>
				</Field>

				<Field label="Connection" hint="token lifecycle">
					<Segment
						name="Connection"
						options={DEV_CONNECTION_STATES}
						value={o.connectionState}
						disabled={!o.enabled}
						onChange={(connectionState) => patchDevContext({ connectionState })}
					/>
				</Field>

				<Field label="Storage quota" hint="usage position">
					<Segment
						name="Storage quota"
						options={DEV_STORAGE_QUOTAS}
						value={o.storageQuota}
						disabled={!o.enabled}
						onChange={(storageQuota) => patchDevContext({ storageQuota })}
					/>
				</Field>

				<Field label="Asset scope" hint="privacy">
					<Segment
						name="Asset scope"
						options={DEV_ASSET_VISIBILITIES}
						value={o.assetVisibility}
						disabled={!o.enabled}
						onChange={(assetVisibility) => patchDevContext({ assetVisibility })}
					/>
				</Field>

				<Field label="Link scan" hint="safety verdict">
					<Segment
						name="Link scan"
						options={DEV_LINK_SCANS}
						value={o.linkScan}
						disabled={!o.enabled}
						onChange={(linkScan) => patchDevContext({ linkScan })}
					/>
				</Field>

				<Field label="Next upload" hint="dedup verdict">
					<Segment
						name="Next upload"
						options={DEV_DEDUP_STATES}
						value={o.dedupState}
						disabled={!o.enabled}
						onChange={(dedupState) => patchDevContext({ dedupState })}
					/>
				</Field>
			</div>

			<div class="dev-ctx__group">
				<div class="dev-ctx__grouphead">Checkout</div>

				<Field label="Basket scope" hint="whose money">
					<Segment
						name="Basket scope"
						options={DEV_BASKET_OWNERS}
						value={o.basketOwner}
						disabled={!o.enabled}
						onChange={(basketOwner) => patchDevContext({ basketOwner })}
					/>
				</Field>

				<Field label="Saved details" hint="Details auto-skip">
					<Segment
						name="Saved details"
						options={DEV_BUYER_DETAILS}
						value={o.buyerDetails}
						disabled={!o.enabled}
						onChange={(buyerDetails) => patchDevContext({ buyerDetails })}
					/>
				</Field>

				<Field label="Billing identity" hint="person / company">
					<Segment
						name="Billing identity"
						options={DEV_BILLING_CONTEXTS}
						value={o.billingContext}
						disabled={!o.enabled}
						onChange={(billingContext) => patchDevContext({ billingContext })}
					/>
				</Field>

				<Field label="Invoicing" hint="business only">
					<Segment
						name="Invoicing"
						options={DEV_INVOICING_MODES}
						value={o.invoicingMode}
						disabled={!o.enabled || o.billingContext !== "business"}
						onChange={(invoicingMode) => patchDevContext({ invoicingMode })}
					/>
				</Field>

				<Field label="Payment offer" hint="provider preset">
					<Segment
						name="Payment offer"
						options={DEV_PAYMENT_PROVIDERS}
						value={o.paymentProviders}
						disabled={!o.enabled}
						onChange={(paymentProviders) => patchDevContext({ paymentProviders })}
					/>
				</Field>

				<Field label="Wallet position" hint="against the total">
					<Segment
						name="Wallet position"
						options={DEV_WALLET_COVERAGES}
						value={o.walletCoverage}
						disabled={!o.enabled}
						onChange={(walletCoverage) => patchDevContext({ walletCoverage })}
					/>
				</Field>

				<Field label="Saved cards" hint="cards on file">
					<Segment
						name="Saved cards"
						options={DEV_SAVED_CARDS}
						value={o.savedCards}
						disabled={!o.enabled}
						onChange={(savedCards) => patchDevContext({ savedCards })}
					/>
				</Field>

				<Field label="Spending limit" hint="needs approval">
					<Segment
						name="Spending limit"
						options={DEV_SPEND_LIMITS}
						value={o.spendLimit}
						disabled={!o.enabled}
						onChange={(spendLimit) => patchDevContext({ spendLimit })}
					/>
				</Field>

				<Field label="Fulfilment mix" hint="confirmation routes">
					<Segment
						name="Fulfilment mix"
						options={DEV_FULFILMENT_MIXES}
						value={o.fulfilmentMix}
						disabled={!o.enabled}
						onChange={(fulfilmentMix) => patchDevContext({ fulfilmentMix })}
					/>
				</Field>

				<Field label="Conferencing" hint="session join link">
					<Segment
						name="Conferencing"
						options={DEV_CONFERENCING}
						value={o.conferencing}
						disabled={!o.enabled ||
							(o.fulfilmentMix !== "mixed" && o.fulfilmentMix !== "sessions")}
						onChange={(conferencing) => patchDevContext({ conferencing })}
					/>
				</Field>

				{
					/* Calendar & Events — the Event Modal's four gates. The 1-on-1 ⁄ group axis is NOT
				    repeated here: "Service type" above already discriminates the three engagement
				    archetypes, and a second near-duplicate control would only make it ambiguous which
				    one wins. */
				}
				<Field label="Event seat" hint="host / attendee / stranger">
					<Segment
						name="Event seat"
						options={DEV_EVENT_SEATS}
						value={o.eventSeat}
						disabled={!o.enabled}
						onChange={(eventSeat) => patchDevContext({ eventSeat })}
					/>
				</Field>

				<Field label="Your RSVP" hint="the acting seat's answer">
					<Segment
						name="Your RSVP"
						options={DEV_EVENT_RSVPS}
						value={o.eventRsvp}
						disabled={!o.enabled || o.eventSeat === "non_party"}
						onChange={(eventRsvp) => patchDevContext({ eventRsvp })}
					/>
				</Field>

				<Field label="Reschedule" hint="negotiation state">
					<Segment
						name="Reschedule"
						options={DEV_EVENT_RESCHEDULES}
						value={o.eventReschedule}
						disabled={!o.enabled || o.eventSeat === "non_party"}
						onChange={(eventReschedule) => patchDevContext({ eventReschedule })}
					/>
				</Field>

				{
					/* Ungated by the master switch on purpose: the debugger reads LIVE balances, so it is
				    useful precisely when nothing is being simulated. */
				}
				<Field label="Money Flow" hint="live balance debugger">
					<button type="button" class="dev-ctx__reset" onClick={openMoneyFlow}>
						Open debugger
					</button>
				</Field>
			</div>

			{effective && o.enabled && (
				<dl class="dev-ctx__summary" aria-label="Effective context">
					<div>
						<dt>context</dt>
						<dd>{effective.contextType}</dd>
					</div>
					<div>
						<dt>role</dt>
						<dd>{effective.role}</dd>
					</div>
					<div>
						<dt>client</dt>
						<dd data-flag={effective.isClient}>{String(effective.isClient)}</dd>
					</div>
					<div>
						<dt>freelancer</dt>
						<dd data-flag={effective.isFreelancer}>{String(effective.isFreelancer)}</dd>
					</div>
					<div>
						<dt>owner</dt>
						<dd data-flag={o.isOwner}>{String(o.isOwner)}</dd>
					</div>
					<div>
						<dt>entity</dt>
						<dd>{o.activeEntity || "auto"}</dd>
					</div>
				</dl>
			)}

			<div class="dev-ctx__actions">
				<button type="button" class="dev-ctx__reset" onClick={resetDevContext}>Reset</button>
			</div>
		</div>
	);
}
