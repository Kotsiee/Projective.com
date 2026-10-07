import type { JSX } from "preact";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { EscalationNotice, SectionHead, SettingsBlock } from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";
import { kybCopy, kycCopy, payoutCopy, type StatusCopy } from "../../core/verification-model.ts";

/**
 * Overviews — what the contextual modal shows for a section whose editor is too large for it
 * (`page-only`) or lives in a console of its own (`status-escalate`), Decision #150. Each is the
 * section's STATUS plus one high-visibility escalation to `/settings/[section]` — the safeguard that
 * a setting is never hidden or disabled in the modal, only moved one step away.
 */

/** One status line: a label, its state as a word (the tone is never the only channel), and detail. */
function StatusLine(props: { label: string; copy: StatusCopy; anchor?: string }): JSX.Element {
	return (
		<div class="stg-statusline" data-tone={props.copy.tone}>
			<span class="stg-statusline__label">{props.label}</span>
			<span class="stg-statusline__state">
				<span class="stg-statusline__pip" aria-hidden="true" />
				{props.copy.label}
			</span>
			<span class="stg-statusline__detail">{props.copy.detail}</span>
		</div>
	);
}

// #region Scheduling
function clock(minute: number): string {
	return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${
		String(minute % 60).padStart(2, "0")
	}`;
}

export function SchedulingOverview(
	props: { data: SettingsSectionDataOf<"scheduling">; onEscalate: () => void },
): JSX.Element {
	const meta = sectionMeta("scheduling");
	const a = props.data.availability;
	const days = a
		? new Set(a.bands.filter((b) => b.kind === "working_hours").map((b) => b.weekday)).size
		: 0;
	const first = a?.bands.find((b) => b.kind === "working_hours");
	const hours: StatusCopy = !a
		? {
			label: "Unavailable",
			tone: "neutral",
			detail: "Your schedule couldn't be read just now.",
			action: null,
		}
		: days === 0
		? {
			label: "Not set",
			tone: "warning",
			detail: "Clients can't see when you work yet.",
			action: null,
		}
		: {
			label: a.published ? "Published" : "Draft",
			tone: a.published ? "success" : "info",
			detail: `${days} ${days === 1 ? "day" : "days"} a week${
				first ? `, from ${clock(first.startMinute)}` : ""
			} · ${a.timezone}`,
			action: null,
		};
	const call = a?.call ?? null;
	const calls: StatusCopy | null = call === null ? null : call.acceptsCalls
		? {
			label: "Accepting",
			tone: "success",
			detail: call.courtesyEnabled
				? `Free ${call.courtesyDurationMinutes}-minute courtesy calls are on.`
				: "Courtesy calls are off.",
			action: null,
		}
		: {
			label: "Off",
			tone: "neutral",
			detail: "Clients can't book a call with you.",
			action: null,
		};
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<SettingsBlock anchor="working-hours" title="At a glance">
				<StatusLine label="Working hours" copy={hours} />
				{calls ? <StatusLine label="Discovery calls" copy={calls} /> : null}
			</SettingsBlock>
			<EscalationNotice
				text="Your weekly schedule and call rules need more room than this window has."
				actionLabel="Configure Full Schedule in Console"
				onEscalate={props.onEscalate}
			/>
		</div>
	);
}
// #endregion

// #region Verification
export function VerificationOverview(
	props: {
		data: SettingsSectionDataOf<"verification">;
		error: string | null;
		onEscalate: () => void;
	},
): JSX.Element {
	const meta = sectionMeta("verification");
	const s = props.data.status;
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<SettingsBlock anchor="identity-check" title="Status">
				{!s
					? <p class="stg-note">{props.error ?? "We couldn't read your verification just now."}</p>
					: (
						<>
							{s.isFreelancer
								? <StatusLine label="Identity (Level 2)" copy={kycCopy(s.kycStatus)} />
								: null}
							{s.isFreelancer
								? <StatusLine label="Payout account" copy={payoutCopy(s.payoutAccount)} />
								: null}
							{s.businesses.map((b) => (
								<StatusLine key={b.id} label={b.name} copy={kybCopy(b.kybStatus, b.canManage)} />
							))}
							{!s.isFreelancer && s.businesses.length === 0
								? (
									<p class="stg-note">
										Paying on Projective never needs an ID check. You'll only verify here if you
										start earning or manage a business.
									</p>
								)
								: null}
						</>
					)}
			</SettingsBlock>
			<EscalationNotice
				text="Checks open Stripe's secure pages, so they start from the Verification console."
				actionLabel="Manage Verification in Console"
				onEscalate={props.onEscalate}
			/>
		</div>
	);
}
// #endregion

// #region Integrations
const BROKEN = new Set(["expired", "error", "degraded", "disconnected"]);

export function IntegrationsOverview(
	props: {
		data: SettingsSectionDataOf<"integrations">;
		error: string | null;
		onEscalate: () => void;
	},
): JSX.Element {
	const meta = sectionMeta("integrations");
	const view = props.data.view;
	const live = view?.connections.filter((c) => c.status !== "revoked") ?? [];
	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<SettingsBlock anchor="storage" title="Connected">
				{!view
					? <p class="stg-note">{props.error ?? "Your connections couldn't be loaded just now."}</p>
					: live.length === 0
					? <p class="stg-note">Nothing is connected yet.</p>
					: live.map((c) => (
						<StatusLine
							key={c.id}
							label={c.externalAccountLabel
								? `${c.providerLabel} · ${c.externalAccountLabel}`
								: c.providerLabel}
							copy={BROKEN.has(c.status)
								? {
									label: "Needs reconnecting",
									tone: "warning",
									detail: "It has stopped syncing.",
									action: null,
								}
								: c.status === "pending"
								? {
									label: "Connecting",
									tone: "info",
									detail: "Waiting for the provider to finish.",
									action: null,
								}
								: {
									label: "Connected",
									tone: "success",
									detail: c.lastSyncedAt ? "Syncing normally." : "Connected.",
									action: null,
								}}
						/>
					))}
			</SettingsBlock>
			<EscalationNotice
				text="Connecting a service opens its own sign-in page, so it starts from the Integrations console."
				actionLabel="Manage Integrations in Console"
				onEscalate={props.onEscalate}
			/>
		</div>
	);
}
// #endregion
