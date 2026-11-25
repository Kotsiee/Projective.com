import type { JSX } from "preact";
import { useContext, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import type {
	ConnectionsView,
	S3ConnectionStart,
	UserConnection,
} from "@projective/types/integrations";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { IntegrationsService } from "@features/files/core/IntegrationsService.ts";
import { type DevCalendarConnection, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import {
	consentReturnPath,
	INTEGRATION_GROUPS,
	type IntegrationGroup,
	type IntegrationGroupKey,
	integrationRows,
	type S3Draft,
	s3SavePayload,
	withoutConsentMarker,
} from "../../core/integrations-model.ts";
import { sectionMeta } from "../../core/settings-registry.ts";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
	SettingsSurfaceContext,
} from "../SettingsParts.tsx";
import {
	type IntegrationRowActions,
	IntegrationRowView,
} from "./integrations/IntegrationRowView.tsx";
import { S3SetupForm } from "./integrations/S3SetupForm.tsx";

/** Props for {@link IntegrationsSection}. */
export interface IntegrationsSectionProps {
	data: SettingsSectionDataOf<"integrations">;
	/** Why the section's read failed, shown in place of the catalogue. */
	error: string | null;
}

/** One block's last outcome. */
interface BlockStatus {
	group: IntegrationGroupKey;
	state: SaveState;
}

const SIMULATED_AT = "2026-01-01T00:00:00.000Z";

function simulatedCalendar(state: Exclude<DevCalendarConnection, "auto">): UserConnection {
	return {
		id: "dev-calendar",
		userId: "dev",
		providerSlug: "google",
		providerLabel: "Google",
		providerCategory: "calendar",
		providerCapabilities: ["calendar", "freebusy"],
		status: state === "expired" ? "expired" : "active",
		grantedKinds: ["calendar", "freebusy"],
		grantedScopes: [],
		syncDirection: state === "publishing" ? "bidirectional" : "inbound",
		externalAccountId: null,
		externalAccountLabel: "you@example.com",
		tokenExpiresAt: null,
		lastSyncedAt: null,
		lastError: null,
		errorCount: 0,
		config: null,
		connectedAt: SIMULATED_AT,
		revokedAt: null,
		createdAt: SIMULATED_AT,
		updatedAt: SIMULATED_AT,
	};
}

function currentHref(): string {
	return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Settings → Integrations (Decision #440) — the ONE place a connection to another service is made,
 * repaired or taken back, in the contextual modal and on the console page alike. Every trigger in the
 * product (`/calendar`'s Connect, `/files`' Connect a drive, a "Connect one" beside a field) opens it
 * with `openSettings("integrations", anchor)` on the block it came for.
 *
 * Connect NAVIGATES to the provider's consent screen; it never fetches it. The consent comes back to
 * the page the modal was opened over, with the modal reopened here, and this section says how it
 * went and drops the marker, so closing it leaves the person where they were. A disconnect asks in
 * place first, because reconnecting needs a fresh consent.
 */
export function IntegrationsSection(props: IntegrationsSectionProps): JSX.Element {
	const { mode } = useContext(SettingsSurfaceContext);
	const meta = sectionMeta("integrations");
	const view = useSignal<ConnectionsView | null>(props.data.view);
	const loadError = useSignal<string | null>(props.error);
	const starting = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const revoking = useSignal<string | null>(null);
	const writing = useSignal(false);
	const revision = useSignal(0);
	const outcome = useSignal<SaveState>(IDLE);
	const blockStatus = useSignal<BlockStatus | null>(null);
	const simulated = useSignal<DevCalendarConnection>("auto");
	const s3Setup = useSignal<S3ConnectionStart | null>(null);
	const s3Saving = useSignal(false);
	const s3Error = useSignal<string | null>(null);

	useEffect(() => {
		const marker = IntegrationsService.completionFrom(currentHref());
		if (marker) {
			outcome.value = marker === "connected"
				? { tone: "saved", text: "Connected. What it reaches may take a moment to show." }
				: {
					tone: "error",
					text: "That connection wasn't completed. Nothing changed, and you can try again.",
				};
			const state = history.state && typeof history.state === "object" ? history.state : {};
			history.replaceState(
				{ ...state, fClientNav: false },
				"",
				withoutConsentMarker(currentHref()),
			);
		}
		simulated.value = readDevSeam()?.calendarConnection ?? "auto";
		return subscribeDevSeam((s) => (simulated.value = s?.calendarConnection ?? "auto"));
	}, []);

	function report(group: IntegrationGroupKey, state: SaveState): void {
		blockStatus.value = { group, state };
	}

	async function refresh(group: IntegrationGroupKey | null): Promise<boolean> {
		const res = await IntegrationsService.connections();
		revision.value += 1;
		if (res.ok && res.data) {
			view.value = res.data;
			loadError.value = null;
			return true;
		}
		const message = res.message ?? "Your connections couldn't be refreshed.";
		if (group) report(group, { tone: "error", text: message });
		else loadError.value = message;
		return false;
	}

	async function connect(group: IntegrationGroupKey, slug: string): Promise<void> {
		if (starting.value) return;
		if (view.value?.providers.find((p) => p.slug === slug)?.authScheme === "aws_sigv4") {
			return openS3(group, slug);
		}
		starting.value = slug;
		report(group, { tone: "busy", text: "Opening the sign-in page…" });
		const res = await IntegrationsService.start({
			providerSlug: slug,
			returnTo: consentReturnPath(currentHref(), mode),
		});
		if (res.ok && res.data?.authorizeUrl) {
			globalThis.location.assign(res.data.authorizeUrl);
			return;
		}
		starting.value = null;
		report(group, {
			tone: "error",
			text: res.message ?? "That connection couldn't be started.",
		});
	}

	/** S3 has no consent screen: open its pending connection and show the credential form here. */
	async function openS3(group: IntegrationGroupKey, slug: string): Promise<void> {
		starting.value = slug;
		report(group, { tone: "busy", text: "Opening the form…" });
		const res = await IntegrationsService.openS3();
		starting.value = null;
		if (!res.ok || !res.data) {
			report(group, { tone: "error", text: res.message ?? "That storage couldn't be connected." });
			return;
		}
		s3Setup.value = res.data;
		s3Error.value = null;
		report(group, IDLE);
		await refresh(group);
	}

	async function saveS3(group: IntegrationGroupKey, draft: S3Draft): Promise<void> {
		const setup = s3Setup.value;
		if (!setup) return;
		s3Saving.value = true;
		s3Error.value = null;
		const res = await IntegrationsService.saveS3(s3SavePayload(setup.connectionId, draft));
		s3Saving.value = false;
		if (!res.ok) {
			s3Error.value = res.message ?? "That storage couldn't be connected.";
			return;
		}
		s3Setup.value = null;
		if (await refresh(group)) {
			report(group, { tone: "saved", text: "Storage connected. It's in Files now." });
		}
	}

	async function disconnect(group: IntegrationGroupKey, c: UserConnection): Promise<void> {
		revoking.value = c.id;
		report(group, { tone: "busy", text: "Disconnecting…" });
		const res = await IntegrationsService.revoke({ connectionId: c.id });
		if (!res.ok) {
			revoking.value = null;
			report(group, {
				tone: "error",
				text: res.message ?? "That connection couldn't be disconnected.",
			});
			return;
		}
		const fresh = await refresh(group);
		revoking.value = null;
		confirming.value = null;
		if (fresh) report(group, { tone: "saved", text: `${c.providerLabel} is disconnected.` });
	}

	async function publish(
		group: IntegrationGroupKey,
		c: UserConnection,
		on: boolean,
	): Promise<void> {
		writing.value = true;
		report(group, { tone: "busy", text: "Saving…" });
		const res = await IntegrationsService.setSyncDirection({
			connectionId: c.id,
			syncDirection: on ? "bidirectional" : "inbound",
		});
		const fresh = await refresh(group);
		writing.value = false;
		if (!res.ok) {
			report(group, {
				tone: "error",
				text: res.message ?? "That calendar couldn't be changed right now.",
			});
		} else if (fresh) {
			report(group, {
				tone: "saved",
				text: on ? "Publishing to a separate calendar." : "Publishing is off.",
			});
		}
	}

	function actionsFor(group: IntegrationGroupKey): IntegrationRowActions {
		return {
			connect: (slug) => void connect(group, slug),
			askDisconnect: (c) => (confirming.value = `${group}:${c.id}`),
			cancelDisconnect: () => (confirming.value = null),
			disconnect: (c) => void disconnect(group, c),
			publish: (c, on) => void publish(group, c, on),
		};
	}

	const v = view.value;
	const sim = simulated.value;
	const override = sim === "auto" ? null : [simulatedCalendar(sim)];
	const locked = starting.value !== null || revoking.value !== null || writing.value ||
		s3Saving.value;

	function block(group: IntegrationGroup, data: ConnectionsView): JSX.Element | null {
		const rows = integrationRows(data, group, group.kind === "calendar" ? override : null);
		if (group.kind === null && rows.length === 0) return null;
		const status = blockStatus.value?.group === group.key ? blockStatus.value.state : IDLE;
		const act = actionsFor(group.key);
		return (
			<SettingsBlock
				key={group.key}
				anchor={group.key}
				title={group.title}
				description={group.description}
			>
				{rows.length > 0
					? (
						<ul class="stg-providers" aria-label={group.title}>
							{rows.map((row) => {
								const id = row.state === "connected" ? row.connection.id : row.provider.slug;
								return (
									<IntegrationRowView
										key={id}
										row={row}
										locked={locked}
										starting={starting.value}
										confirming={confirming.value === `${group.key}:${id}`}
										revoking={revoking.value === id}
										simulated={row.state === "connected" && override !== null &&
											group.kind === "calendar"}
										revision={revision.value}
										act={act}
									/>
								);
							})}
						</ul>
					)
					: <p class="stg-note">{group.empty}</p>}
				{group.key === "storage" && s3Setup.value
					? (
						<S3SetupForm
							key={s3Setup.value.connectionId}
							start={s3Setup.value}
							saving={s3Saving.value}
							error={s3Error.value}
							onSave={(draft) => void saveS3(group.key, draft)}
							onCancel={() => (s3Setup.value = null)}
						/>
					)
					: null}
				<SaveStatus state={status} />
			</SettingsBlock>
		);
	}

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<SaveStatus state={outcome.value} />
			{v ? INTEGRATION_GROUPS.map((group) => block(group, v)) : (
				<InlineNotice
					align="start"
					assertive
					text={loadError.value ?? "Your connections couldn't be loaded just now."}
					actionLabel="Try again"
					onAction={() => void refresh(null)}
				/>
			)}
		</div>
	);
}
