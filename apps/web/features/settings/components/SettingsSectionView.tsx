import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import type { UserContext } from "@projective/types/auth";
import type {
	SettingsSectionData,
	SettingsSectionEnvelope,
	SettingsSectionKey,
} from "@projective/types/settings";
import { SettingsService } from "../core/SettingsService.ts";
import { anchorId, sectionMeta } from "../core/settings-registry.ts";
import { SectionHead, SettingsSurfaceContext } from "./SettingsParts.tsx";
import { AccountSection } from "./sections/AccountSection.tsx";
import { ProfileSection } from "./sections/ProfileSection.tsx";
import { WorkspacesSection } from "./sections/WorkspacesSection.tsx";
import { LanguageSection } from "./sections/LanguageSection.tsx";
import { AppearanceSection } from "./sections/AppearanceSection.tsx";
import { NotificationsSection } from "./sections/NotificationsSection.tsx";
import { MessagingSection } from "./sections/MessagingSection.tsx";
import { SchedulingSection } from "./sections/SchedulingSection.tsx";
import { BillingSection } from "./sections/BillingSection.tsx";
import {
	IntegrationsOverview,
	SchedulingOverview,
	VerificationOverview,
} from "./sections/Overviews.tsx";

/**
 * SettingsSectionView — renders one Settings section on either surface (Decision #150). The page
 * hands it the server-rendered payload; the modal lets it fetch the same payload from
 * `/api/settings/[section]`. It chooses the full editor or — in the modal, for a `page-only` or
 * `status-escalate` section — the status overview with its escalation, then brings the requested
 * anchor into view and, when asked, moves keyboard focus into it.
 */

export interface SettingsSectionViewProps {
	section: SettingsSectionKey;
	mode: "modal" | "page";
	/** The EFFECTIVE context (dev persona axes applied) — gates entries, drives Workspaces. */
	context: UserContext;
	/** The page's server-rendered read; absent in the modal. */
	initial?: SettingsSectionEnvelope | null;
	/** A registry anchor to bring into view. */
	anchor?: string | null;
	/** Bumped to ask for focus to move into the section (after search → Enter, or a tree activation). */
	focusRequest?: number;
	/** Take the person to the console page of a section (the escalation). */
	onEscalate: (section: SettingsSectionKey, anchor?: string | null) => void;
	/** Switch to another section in place (the modal only). */
	onOpenSection?: (section: SettingsSectionKey, anchor?: string | null) => void;
}

/** The first thing keyboard focus can land on inside `root`. */
function firstFocusable(root: Element): HTMLElement | null {
	return root.querySelector<HTMLElement>(
		'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="radio"][tabindex="0"], [role="switch"]:not([aria-disabled="true"]), [tabindex="0"]',
	);
}

export function SettingsSectionView(props: SettingsSectionViewProps): JSX.Element {
	const { section, mode } = props;
	const envelope = useSignal<SettingsSectionEnvelope | null>(
		props.initial && props.initial.data.section === section ? props.initial : null,
	);
	const failure = useSignal<string | null>(null);
	const attempt = useSignal(0);
	const rootRef = useRef<HTMLDivElement>(null);

	// The modal reads on demand; the page already has its payload.
	useEffect(() => {
		if (envelope.peek()?.data.section === section) return;
		let live = true;
		envelope.value = null;
		failure.value = null;
		SettingsService.section(section).then((res) => {
			if (!live) return;
			if (res.ok) envelope.value = res.data as SettingsSectionEnvelope;
			else failure.value = res.message;
		});
		return () => {
			live = false;
		};
	}, [section, attempt.value]);

	const loaded = envelope.value?.data.section === section;

	// Bring the anchor into view once the section is drawn, and hand it focus when asked.
	useEffect(() => {
		if (!loaded) return;
		const root = rootRef.current;
		if (!root) return;
		const target = props.anchor ? root.querySelector(`#${anchorId(props.anchor)}`) : null;
		if (target) target.scrollIntoView({ block: "start" });
		if (props.focusRequest) (firstFocusable(target ?? root) ?? firstFocusable(root))?.focus();
	}, [loaded, props.anchor, props.focusRequest]);

	const meta = sectionMeta(section);
	let body: JSX.Element;
	if (failure.value) {
		body = (
			<div class="stg-section">
				<SectionHead title={meta.label} description={meta.description} />
				<InlineNotice
					align="start"
					assertive
					text={failure.value}
					actionLabel="Try again"
					onAction={() => (attempt.value += 1)}
				/>
			</div>
		);
	} else if (!loaded) {
		body = (
			<div class="stg-section" aria-busy="true">
				<SectionHead title={meta.label} description={meta.description} />
				<p class="stg-note" role="status">Loading…</p>
			</div>
		);
	} else {
		body = renderSection(envelope.value!.data, envelope.value!.error, props);
	}

	return (
		<SettingsSurfaceContext.Provider value={{ mode }}>
			<div ref={rootRef} class={`stg-view stg-view--${mode}`} data-section={section}>
				{body}
			</div>
		</SettingsSurfaceContext.Provider>
	);
}

/** Pick the editor or the overview for a loaded section. */
function renderSection(
	data: SettingsSectionData,
	error: string | null,
	props: SettingsSectionViewProps,
): JSX.Element {
	const escalate = (anchor?: string | null) => () =>
		props.onEscalate(data.section, anchor ?? props.anchor ?? null);
	const modal = props.mode === "modal";
	switch (data.section) {
		case "account":
			return <AccountSection data={data} />;
		case "profile":
			return <ProfileSection data={data} />;
		case "workspaces":
			return <WorkspacesSection context={props.context} />;
		case "language":
			return <LanguageSection data={data} />;
		case "appearance":
			return <AppearanceSection data={data} />;
		case "notifications":
			return <NotificationsSection data={data} />;
		case "messaging":
			return (
				<MessagingSection
					data={data}
					onOpenSection={props.onOpenSection
						? (section, anchor) => props.onOpenSection!(section, anchor)
						: undefined}
				/>
			);
		case "scheduling":
			return modal
				? <SchedulingOverview data={data} onEscalate={escalate()} />
				: <SchedulingSection data={data} />;
		case "billing":
			return <BillingSection />;
		case "verification":
			return <VerificationOverview data={data} error={error} onEscalate={escalate()} />;
		case "integrations":
			return <IntegrationsOverview data={data} error={error} onEscalate={escalate()} />;
	}
}
