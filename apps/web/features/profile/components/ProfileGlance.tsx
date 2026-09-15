import type { JSX } from "preact";
import { MoneyView } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
import { estimatedSpendFor, isFastResponder, responseLabel } from "../core/profile-model.ts";
import type { ProfileView, ServiceItem } from "../types/profile-types.ts";

/**
 * ProfileGlance — the context bar's at-a-glance facts: the measured reply speed, the two earned or
 * disclosed marks ("Fast responder" · "Free consultation"), and the estimated spend floor across the
 * seller's listings.
 *
 * A SERVER component: every fact is server-resolved data or a pure derivation over it. The marks are
 * containers by §B.11's own carve-out — one is a trust signal the profile EARNED against the same
 * threshold the discovery card's chip uses, the other a disclosure of an offer a buyer came to find —
 * and they render monochrome on the shared `.pf-tag` vocabulary. A fact that is absent is omitted
 * whole: no "Avg. response —", no zero-priced floor. When nothing survives the block renders nothing.
 */
export interface ProfileGlanceProps {
	profile: ProfileView;
	services: ServiceItem[];
}

export function hasGlance(profile: ProfileView, services: ServiceItem[]): boolean {
	return profile.responseMinutes !== null || profile.freeConsultation ||
		estimatedSpendFor(services) !== null;
}

export function ProfileGlance({ profile, services }: ProfileGlanceProps): JSX.Element | null {
	const minutes = profile.responseMinutes;
	const spend = estimatedSpendFor(services);
	const marks: Array<{ key: string; label: string; icon: "clock" | "calendar" }> = [];
	if (isFastResponder(minutes)) marks.push({ key: "fast", label: "Fast responder", icon: "clock" });
	if (profile.freeConsultation) {
		marks.push({ key: "consult", label: "Free consultation", icon: "calendar" });
	}
	if (minutes === null && marks.length === 0 && !spend) return null;

	return (
		<div class="pf-glance">
			{(minutes !== null || spend) && (
				<dl class="pf-glance__facts">
					{minutes !== null && (
						<div class="pf-glance__fact">
							<dt class="pf-glance__label">Avg. response</dt>
							<dd class="pf-glance__value">{responseLabel(minutes)}</dd>
						</div>
					)}
					{spend && (
						<div class="pf-glance__fact">
							<dt class="pf-glance__label">Est. project spend</dt>
							<dd class="pf-glance__value">
								<span class="pf-glance__from">from</span>{" "}
								<MoneyView
									minor={spend.amount.minor}
									currency={spend.amount.currency}
									hideOrigin
								/>
								{spend.unit && <span class="pf-glance__unit">/ {spend.unit}</span>}
							</dd>
						</div>
					)}
				</dl>
			)}
			{marks.length > 0 && (
				<ul class="pf-marks" role="list" aria-label="Highlights">
					{marks.map((mark) => (
						<li class="pf-tag pf-mark" key={mark.key}>
							<Icon name={mark.icon} size="2xs" class="pf-mark__icon" />
							{mark.label}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
