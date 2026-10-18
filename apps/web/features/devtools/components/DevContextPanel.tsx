import type { ComponentChildren, JSX } from "preact";
import "../styles/dev-context.css";
import type { UserContext } from "@projective/types/auth";
import {
	ACCOUNT_TYPES,
	applyDevContext,
	DEV_ACCOUNT_LIFECYCLES,
	DEV_LAYOUT_DIRECTIONS,
	DEV_MEMBER_CLIENTS,
	DEV_MEMBER_ROLES,
	DEV_MESSAGING_ROLES,
	DEV_MIC_PERMISSIONS,
	DEV_PROFILE_SETUPS,
	DEV_PROJECT_ACCESSES,
	DEV_PROJECT_ONBOARDINGS,
	DEV_PROJECT_STATUSES,
	DEV_PROJECT_TYPES,
	DEV_PROPOSAL_ALLOWANCES,
	DEV_REVISION_ALLOTMENTS,
	DEV_AUTO_FUND_MODES,
	DEV_LOW_BALANCES,
	DEV_BUSINESS_KYBS,
	DEV_BUSINESS_PAGES,
	DEV_SESSION_STATES,
	DEV_DISPUTE_STATES,
	DEV_NOTIFICATIONS,
	DEV_BASKET_SCENARIOS,
	DEV_CHECKOUT_GATES,
	DEV_PROMO_DISMISSALS,
	DEV_DISCOVERY_VIEWERS,
	DEV_DISCOVERY_ACTIVITIES,
	DEV_EMAIL_CONFIRMATIONS,
	DEV_AGE_RESTRICTIONS,
	DEV_PAYOUT_READINESS,
	DEV_BUSINESS_PLAN_GATES,
	DEV_OPERATOR_MODES,
	DEV_OPERATOR_DESKS,
	DEV_CATALOGUE_ANALYTICS,
	DEV_CLIENT_PIPELINES,
	DEV_AVAILABILITY_CONFLICTS,
	DEV_EMBEDDINGS,
	DEV_ROLES,
	DEV_SAVED,
	DEV_SERVICE_TYPES,
	DEV_SESSION_BOOKINGS,
	DEV_SETTINGS_ATTENTIONS,
	DEV_STAGE_ASSIGNMENTS,
	DEV_SUBMISSION_STATES,
	DEV_TRUST_ADORNMENTS,
	DEV_FUNDING_STATES,
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
import { DevThemeControls } from "./DevThemeControls.tsx";
import { DevEmbeddingsStatus } from "./DevEmbeddingsStatus.tsx";
import { DevPayoutReadyAction } from "./DevPayoutReadyAction.tsx";

// #region Props
/** Props for {@link DevContextPanel}. */
export interface DevContextPanelProps {
	/** The developer's real (hydrated) context, so the panel can show the effective, overridden result. */
	baseContext?: UserContext;
}
// #endregion

/** A labelled row wrapping a segmented control or toggle. */
function Field(props: { label: string; hint?: string; children: ComponentChildren }): JSX.Element {
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

/**
 * Reload when the open page is `/explore`, so a server-side discovery simulation re-composes its rails
 * at once. Elsewhere nothing reads it until the next `/explore` request.
 */
function reloadExplorePage(): void {
	if (globalThis.location?.pathname === "/explore") globalThis.location.reload();
}

/**
 * Reload when the open page is a profile (`/@handle…`), so a server-side business-page simulation
 * applies at once. Elsewhere nothing reads it until the next profile request.
 */
function reloadProfilePage(): void {
	if (globalThis.location?.pathname.startsWith("/@")) globalThis.location.reload();
}

function reloadDiscoveryPage(): void {
	const path = globalThis.location?.pathname ?? "";
	if (path === "/explore" || path.includes("/view/")) globalThis.location.reload();
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

				{
					/* Only a business client delegates its tickets to a project admin/manager (Decision
				    #294), and no fixture is billed to one: `Business` is the only runtime route to the row
				    action that grants it. */
				}
				<Field label="Paying client" hint="ticket delegation">
					<Segment
						name="Paying client"
						options={DEV_MEMBER_CLIENTS}
						value={o.memberClient}
						disabled={!o.enabled}
						onChange={(memberClient) => patchDevContext({ memberClient })}
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

				<div class="dev-ctx__grouphead">Catalogue</div>

				{
					/* The two fixture reads answer `?sim=` only while CATALOGUE_BACKEND_LIVE is off; the
				    availability conflict is client-only and never reaches the save gate. */
				}
				<Field label="Analytics" hint="fixture shape">
					<Segment
						name="Catalogue analytics"
						options={DEV_CATALOGUE_ANALYTICS}
						value={o.catalogueAnalytics}
						disabled={!o.enabled}
						onChange={(catalogueAnalytics) => patchDevContext({ catalogueAnalytics })}
					/>
				</Field>

				<Field label="Client pipeline" hint="fixture lanes">
					<Segment
						name="Client pipeline"
						options={DEV_CLIENT_PIPELINES}
						value={o.clientPipeline}
						disabled={!o.enabled}
						onChange={(clientPipeline) => patchDevContext({ clientPipeline })}
					/>
				</Field>

				<Field label="Availability" hint="Issues · readiness">
					<Segment
						name="Availability conflict"
						options={DEV_AVAILABILITY_CONFLICTS}
						value={o.availabilityConflict}
						disabled={!o.enabled}
						onChange={(availabilityConflict) => patchDevContext({ availabilityConflict })}
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
					/* A business's /:handle (Decision #244). Its status and visibility are database states
				    and both seeded businesses are active and public, so this is the only route to a
				    member's notice (draft · archived · invite-only) or an outsider's 404 (Missing).
				    Server-side via `pj.dev.business-page`, so a change reloads a profile page. */
				}
				<Field label="Business page" hint="member notice · outsider 404 · reloads">
					<Segment
						name="Business page"
						options={DEV_BUSINESS_PAGES}
						value={o.businessPage}
						disabled={!o.enabled}
						onChange={(businessPage) => {
							patchDevContext({ businessPage });
							reloadProfilePage();
						}}
					/>
				</Field>

				{
					/* The ticket funding line (Decision #165). Holds, refused holds and card payments are
				    server facts, so this substitutes the STATE; the card's real amount still shows. It also
				    drives the board's column lock (Decision #210): a claimed card forced off Funded reads its
				    work columns as locked, while the server still refuses from the real escrow. */
				}
				<Field label="Funding state" hint="ticket funding line · board column lock">
					<Segment
						name="Funding state"
						options={DEV_FUNDING_STATES}
						value={o.fundingState}
						disabled={!o.enabled}
						onChange={(fundingState) => patchDevContext({ fundingState })}
					/>
				</Field>

				{
					/* The submission review's revision allotment (Decision #167). Free rounds are used only
				    by real reviews and a paid round opens only on a real payment, so this substitutes the
				    review's view of them; the server still refuses from the real allotment. */
				}
				<Field label="Revisions" hint="submission review allotment">
					<Segment
						name="Revisions"
						options={DEV_REVISION_ALLOTMENTS}
						value={o.revisionAllotment}
						disabled={!o.enabled}
						onChange={(revisionAllotment) => patchDevContext({ revisionAllotment })}
					/>
				</Field>

				{
					/* Business billing (PRODUCT_SPEC §Escrow, Wallets & Finance #4). The real auto-fund mode
				    acts only on a refused hold and the floor only on a real debit, so these substitute the
				    Billing module's (and the funded line's) view of them; the server is unchanged. */
				}
				<Field label="Auto-fund" hint="billing module · funded line">
					<Segment
						name="Auto-fund"
						options={DEV_AUTO_FUND_MODES}
						value={o.autoFundMode}
						disabled={!o.enabled}
						onChange={(autoFundMode) => patchDevContext({ autoFundMode })}
					/>
				</Field>
				<Field label="Low balance" hint="billing module warning">
					<Segment
						name="Low balance"
						options={DEV_LOW_BALANCES}
						value={o.lowBalance}
						disabled={!o.enabled}
						onChange={(lowBalance) => patchDevContext({ lowBalance })}
					/>
				</Field>

				{/* A business's KYB is written only by Stripe; this substitutes the Verification module's picture. */}
				<Field label="Business KYB" hint="verification module">
					<Segment
						name="Business KYB"
						options={DEV_BUSINESS_KYBS}
						value={o.businessKyb}
						disabled={!o.enabled}
						onChange={(businessKyb) => patchDevContext({ businessKyb })}
					/>
				</Field>

				{
					/* A session's server-only facts (Decision #171): a full cohort on the listing lane, a
				    sitting in progress or over (the join control, the counter), and a seat escrow inside
				    the 24-hour negative-consent window (the session funding line). The database still
				    refuses a full cohort and withholds a join URL outside its window. */
				}
				<Field label="Session" hint="seats · join window · auto-release">
					<Segment
						name="Session state"
						options={DEV_SESSION_STATES}
						value={o.sessionState}
						disabled={!o.enabled}
						onChange={(sessionState) => patchDevContext({ sessionState })}
					/>
				</Field>

				{
					/* A session's no-show dispute (Decision #212): the Report no-show action and the dispute
				    section's every status and ruling. The previewed case is client-side; every write still
				    goes to the database. */
				}
				<Field label="Dispute" hint="no-show claim · response · ruling">
					<Segment
						name="Dispute state"
						options={DEV_DISPUTE_STATES}
						value={o.disputeState}
						disabled={!o.enabled}
						onChange={(disputeState) => patchDevContext({ disputeState })}
					/>
				</Field>

				{
					/* The notification inbox (DESIGN_SYSTEM §D.9) — the header drawer and `/notifications`.
				    An empty inbox, a full one and a run of live arrivals all wait on other people's actions,
				    so the thin service substitutes them here; nothing is written to the server. */
				}
				<Field label="Notifications" hint="drawer · inbox page · live arrivals">
					<Segment
						name="Notifications"
						options={DEV_NOTIFICATIONS}
						value={o.notifications}
						disabled={!o.enabled}
						onChange={(notifications) => patchDevContext({ notifications })}
					/>
				</Field>

				{
					/* The header basket drawer. A second paying account and a delisted line both wait on
				    other people, so the drawer substitutes its read here; writes still reach the server. */
				}
				<Field label="Basket" hint="drawer · switcher · unavailable line">
					<Segment
						name="Basket"
						options={DEV_BASKET_SCENARIOS}
						value={o.basketScenario}
						disabled={!o.enabled}
						onChange={(basketScenario) => patchDevContext({ basketScenario })}
					/>
				</Field>

				{
					/* A business checkout's gate (Decision #243). Each state waits on a threshold, an envelope,
				    another member's decision or Stripe, so the payment step substitutes its view of a real
				    business session here; Pay and Request approval still reach the server. */
				}
				<Field label="Checkout gate" hint="business payment step">
					<Segment
						name="Checkout gate"
						options={DEV_CHECKOUT_GATES}
						value={o.checkoutGate}
						disabled={!o.enabled}
						onChange={(checkoutGate) => patchDevContext({ checkoutGate })}
					/>
				</Field>

				{
					/* The saved set. Every kind (a listing, a person, a project, a room, a message, a file)
				    takes its own surface to save, so `SavedService` substitutes the whole set here. */
				}
				<Field label="Saved" hint="/saved · stars · save buttons">
					<Segment
						name="Saved"
						options={DEV_SAVED}
						value={o.saved}
						disabled={!o.enabled}
						onChange={(saved) => patchDevContext({ saved })}
					/>
				</Field>

				{
					/* The Explore Home's dismissible promo slots. A dismissal lives in this browser's storage,
				    so this is the only way back to a dismissed slot short of clearing site data. The
				    freelancer audience gate follows the Account type above. */
				}
				<Field label="Explore promos" hint="dismissible slots">
					<Segment
						name="Explore promos"
						options={DEV_PROMO_DISMISSALS}
						value={o.promoDismissal}
						disabled={!o.enabled}
						onChange={(promoDismissal) => patchDevContext({ promoDismissal })}
					/>
				</Field>

				<Field label="Discovery viewer" hint="personal rails cold start">
					<Segment
						name="Discovery viewer"
						options={DEV_DISCOVERY_VIEWERS}
						value={o.discoveryViewer}
						disabled={!o.enabled}
						onChange={(discoveryViewer) => {
							patchDevContext({ discoveryViewer });
							reloadExplorePage();
						}}
					/>
				</Field>

				<Field label="Trending" hint="platform activity">
					<Segment
						name="Trending"
						options={DEV_DISCOVERY_ACTIVITIES}
						value={o.discoveryActivity}
						disabled={!o.enabled}
						onChange={(discoveryActivity) => {
							patchDevContext({ discoveryActivity });
							reloadExplorePage();
						}}
					/>
				</Field>

				<Field label="Embeddings" hint="voyage-4 ranking · reloads">
					<Segment
						name="Embeddings"
						options={DEV_EMBEDDINGS}
						value={o.embeddings}
						disabled={!o.enabled}
						onChange={(embeddings) => {
							patchDevContext({ embeddings });
							reloadDiscoveryPage();
						}}
					/>
					<DevEmbeddingsStatus mode={o.embeddings} enabled={o.enabled} />
				</Field>

				<Field label="Email confirmation" hint="/verify poll">
					<Segment
						name="Email confirmation"
						options={DEV_EMAIL_CONFIRMATIONS}
						value={o.emailConfirmation}
						disabled={!o.enabled}
						onChange={(emailConfirmation) => patchDevContext({ emailConfirmation })}
					/>
				</Field>

				<Field label="Age" hint="buy/sell 403">
					<Segment
						name="Age"
						options={DEV_AGE_RESTRICTIONS}
						value={o.ageRestriction}
						disabled={!o.enabled}
						onChange={(ageRestriction) => patchDevContext({ ageRestriction })}
					/>
				</Field>

				<Field label="Payout-ready" hint="earning 403">
					<Segment
						name="Payout-ready"
						options={DEV_PAYOUT_READINESS}
						value={o.payoutReadiness}
						disabled={!o.enabled}
						onChange={(payoutReadiness) => patchDevContext({ payoutReadiness })}
					/>
				</Field>

				<Field label="Business plan gates" hint="Business Pro 402">
					<Segment
						name="Business plan gates"
						options={DEV_BUSINESS_PLAN_GATES}
						value={o.businessPlanGates}
						disabled={!o.enabled}
						onChange={(businessPlanGates) => patchDevContext({ businessPlanGates })}
					/>
				</Field>

				<Field label="Operator mode" hint="Teams persona 403">
					<Segment
						name="Operator mode"
						options={DEV_OPERATOR_MODES}
						value={o.operatorMode}
						disabled={!o.enabled}
						onChange={(operatorMode) => patchDevContext({ operatorMode })}
					/>
				</Field>

				{
					/* The operator dispute desk (`/admin/disputes`, Decision #212): only an `ops.admin_users` row
				    opens it, and no page control writes one. Server-side via `pj.dev.operator`; reload to apply.
				    Grants nothing — a ruling on a sample still meets the database refusal. */
				}
				<Field label="Operator desk" hint="/admin/disputes">
					<Segment
						name="Operator desk"
						options={DEV_OPERATOR_DESKS}
						value={o.operatorDesk}
						disabled={!o.enabled}
						onChange={(operatorDesk) => patchDevContext({ operatorDesk })}
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
				<Field label="Account lifecycle" hint="Settings → Account">
					<Segment
						name="Account lifecycle"
						options={DEV_ACCOUNT_LIFECYCLES}
						value={o.accountLifecycle}
						disabled={!o.enabled}
						onChange={(accountLifecycle) => patchDevContext({ accountLifecycle })}
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

			<DevThemeControls />

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
				<Field label="Earning gate" hint="live KYC + payout">
					<DevPayoutReadyAction
						simulatedNotReady={o.enabled && o.payoutReadiness === "not_ready"}
					/>
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
