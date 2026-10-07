import type { JSX } from "preact";
import "../styles/dev-context.css";
import type { UserContext } from "@projective/types/auth";
import {
	ACCOUNT_TYPES,
	applyDevContext,
	DEV_LAYOUT_DIRECTIONS,
	DEV_MEMBER_ROLES,
	DEV_MESSAGING_ROLES,
	DEV_MIC_PERMISSIONS,
	DEV_PROFILE_SETUPS,
	DEV_PROJECT_ACCESSES,
	DEV_PROJECT_ONBOARDINGS,
	DEV_PROJECT_STATUSES,
	DEV_PROJECT_TYPES,
	DEV_PROPOSAL_ALLOWANCES,
	DEV_ROLES,
	DEV_SERVICE_TYPES,
	DEV_SESSION_BOOKINGS,
	DEV_SETTINGS_ATTENTIONS,
	DEV_STAGE_ASSIGNMENTS,
	DEV_SUBMISSION_STATES,
	DEV_TRUST_ADORNMENTS,
	DEV_VERIFICATION_STAMPS,
	DEV_WALLET_AURORAS,
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

/**
 * Reload when the open page is an engagement's, so a server-side landing simulation applies at once.
 * Anywhere else nothing reads it until the next `/projects/[slug]` request, so a reload there would
 * only throw the page's state away.
 */
function reloadProjectPage(): void {
	if (globalThis.location?.pathname.startsWith("/projects/")) globalThis.location.reload();
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

				{
					/* The project setup surface's post-onboarding immutability. Both counts are SERVER
				    facts (`projects.stage_assignments`), so this is the only runtime route to a locked
				    setup surface — no control on the form can get you there. `First stage` is the value
				    worth reaching for: a per-stage price lock and a project-wide one look identical on a
				    project whose every stage is onboarded. */
				}
				<Field label="Onboarded providers" hint="setup locks">
					<Segment
						name="Onboarded providers"
						options={DEV_PROJECT_ONBOARDINGS}
						value={o.projectOnboarding}
						disabled={!o.enabled}
						onChange={(projectOnboarding) => patchDevContext({ projectOnboarding })}
					/>
				</Field>

				<div class="dev-ctx__grouphead">Project landing</div>

				{
					/* `/projects/[slug]` dispatches SERVER-side on access × status (Decision #144): an owner's
				    or a participant's Overview, a draft owner sent to Details, a prospect sent to the public
				    listing. The pair rides the `pj.dev.landing` cookie, so a change reloads the page to apply. */
				}
				<Field label="Viewer access" hint="reloads">
					<Segment
						name="Viewer access"
						options={DEV_PROJECT_ACCESSES}
						value={o.projectAccess}
						disabled={!o.enabled}
						onChange={(projectAccess) => {
							patchDevContext({ projectAccess });
							reloadProjectPage();
						}}
					/>
				</Field>

				<Field label="Project status" hint="reloads">
					<Segment
						name="Project status"
						options={DEV_PROJECT_STATUSES}
						value={o.projectStatus}
						disabled={!o.enabled}
						onChange={(projectStatus) => {
							patchDevContext({ projectStatus });
							reloadProjectPage();
						}}
					/>
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

				<Field label="Pending requests" hint="hasPendingRequests">
					<div class="dev-ctx__segment" role="radiogroup" aria-label="Pending requests">
						<button
							type="button"
							role="radio"
							aria-checked={o.hasPendingRequests}
							class="dev-ctx__seg"
							data-active={o.hasPendingRequests}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasPendingRequests: true })}
						>
							Has requests
						</button>
						<button
							type="button"
							role="radio"
							aria-checked={!o.hasPendingRequests}
							class="dev-ctx__seg"
							data-active={!o.hasPendingRequests}
							disabled={!o.enabled}
							onClick={() => patchDevContext({ hasPendingRequests: false })}
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

				<div class="dev-ctx__grouphead">Presentation</div>

				<Field label="Direction" hint="LtR / RtL">
					<Segment
						name="Direction"
						options={DEV_LAYOUT_DIRECTIONS}
						value={o.layoutDirection}
						disabled={!o.enabled}
						onChange={(layoutDirection) => patchDevContext({ layoutDirection })}
					/>
				</Field>

				{
					/* The header account popover's completion ring, go-live nudge and presence pip. Each
				    value is a stored-profile fact no header control can change, so this is the only
				    runtime route to the nudge's "to go live" vs "left" copy and to a published schedule. */
				}
				<Field label="Profile setup" hint="account ring">
					<Segment
						name="Profile setup"
						options={DEV_PROFILE_SETUPS}
						value={o.profileSetup}
						disabled={!o.enabled}
						onChange={(profileSetup) => patchDevContext({ profileSetup })}
					/>
				</Field>

				<Field label="Verification stamp" hint="crest · celebration">
					<Segment
						name="Verification stamp"
						options={DEV_VERIFICATION_STAMPS}
						value={o.verificationStamp}
						disabled={!o.enabled}
						onChange={(verificationStamp) => patchDevContext({ verificationStamp })}
					/>
				</Field>

				<Field label="Trust signals" hint="profile hero">
					<Segment
						name="Trust signals"
						options={DEV_TRUST_ADORNMENTS}
						value={o.trustAdornments}
						disabled={!o.enabled}
						onChange={(trustAdornments) => patchDevContext({ trustAdornments })}
					/>
				</Field>

				{
					/* The `/wallet` hero's live aurora. Its gates read device facts (core count, memory,
				    frame times) no page control can change, so this is the only runtime route to the
				    shader on a machine that `auto` refuses — and to the static gradient on one it allows.
				    Applies live; the hero reflects the outcome on `data-aurora` / `data-aurora-reason`. */
				}
				<Field label="Wallet aurora" hint="hero shader">
					<Segment
						name="Wallet aurora"
						options={DEV_WALLET_AURORAS}
						value={o.walletAurora}
						disabled={!o.enabled}
						onChange={(walletAurora) => patchDevContext({ walletAurora })}
					/>
				</Field>

				{
					/* The `/settings` attention dashboard and the lane's section marks. KYC, payout and
				    connector states are server facts no settings control can change, so this substitutes
				    the FACTS — the shipping rule still decides what is listed. */
				}
				<Field label="Settings attention" hint="/settings dashboard">
					<Segment
						name="Settings attention"
						options={DEV_SETTINGS_ATTENTIONS}
						value={o.settingsAttention}
						disabled={!o.enabled}
						onChange={(settingsAttention) => patchDevContext({ settingsAttention })}
					/>
				</Field>

				{
					/* The proposal allowance — the popover meter, the lane disclosure and the apply modal's
				    pre-flight notice. Tokens, the drip clock and a team roster are server facts no control
				    can reach without spending real proposals, so this substitutes the STATUS; the shipping
				    copy, countdown and gate still run on it. Client-only: the server gate is untouched. */
				}
				<Field label="Proposal allowance" hint="meter · apply gate">
					<Segment
						name="Proposal allowance"
						options={DEV_PROPOSAL_ALLOWANCES}
						value={o.proposalAllowance}
						disabled={!o.enabled}
						onChange={(proposalAllowance) => patchDevContext({ proposalAllowance })}
					/>
				</Field>
			</div>

			<div class="dev-ctx__group">
				<div class="dev-ctx__grouphead">Money</div>

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
