import type { JSX } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button, ToggleSwitch } from "@projective/ui/fields";
import type { UserConnection } from "@projective/types/integrations";
import { providerStatusLabel } from "@features/files/components/ProviderChip.tsx";
import {
	type ConnectedRow,
	disconnectWarning,
	type IntegrationRow,
} from "../../../core/integrations-model.ts";
import { IntegrationGlyph } from "./integration-glyphs.tsx";

/** What a row can ask the section to do. */
export interface IntegrationRowActions {
	connect: (slug: string) => void;
	askDisconnect: (connection: UserConnection) => void;
	cancelDisconnect: () => void;
	disconnect: (connection: UserConnection) => void;
	publish: (connection: UserConnection, on: boolean) => void;
}

/** Props for {@link IntegrationRowView}. */
export interface IntegrationRowViewProps {
	row: IntegrationRow;
	/** A consent or a write is in flight somewhere in the section. */
	locked: boolean;
	/** The provider slug a consent is being started for. */
	starting: string | null;
	/** This row's disconnect is being asked about. */
	confirming: boolean;
	/** This row's connection is being disconnected. */
	revoking: boolean;
	/** The row is the Dev Context Switcher's, so nothing on it writes. */
	simulated: boolean;
	/** Bumped on every re-read, so a switch the server refused returns to what it holds. */
	revision: number;
	act: IntegrationRowActions;
}

/**
 * One provider in Settings → Integrations: its mark, its name, what its connection is, and the one
 * action that can work for it — Connect, Reconnect, Connect again or Disconnect, which asks first in
 * place. A calendar connection also carries its publishing switch.
 */
export function IntegrationRowView(props: IntegrationRowViewProps): JSX.Element {
	const { row } = props;
	if (row.state === "available") {
		const { provider } = row;
		return (
			<li class="stg-provider" data-state="off">
				<IntegrationGlyph slug={provider.slug} />
				<div class="stg-provider__text">
					<span class="stg-provider__name">{provider.label}</span>
					<span class="stg-provider__meta">
						{provider.isBeta ? "Not connected · Beta" : "Not connected"}
					</span>
				</div>
				<div class="stg-provider__actions">
					<Button
						size="sm"
						variant="outlined"
						severity="neutral"
						label={props.starting === provider.slug ? "Opening…" : "Connect"}
						aria-label={`Connect ${provider.label}`}
						disabled={props.locked}
						onClick={() => props.act.connect(provider.slug)}
					/>
				</div>
			</li>
		);
	}
	return <ConnectedRowView {...props} row={row} />;
}

function ConnectedRowView(props: IntegrationRowViewProps & { row: ConnectedRow }): JSX.Element {
	const { row, act } = props;
	const c = row.connection;
	const held = c.syncDirection !== "inbound";
	const publishing = useSignal(held);
	useLayoutEffect(() => {
		publishing.value = held;
	}, [held, props.revision]);
	const meta = [providerStatusLabel(c.status), c.externalAccountLabel].filter(Boolean).join(" · ");
	return (
		<li class="stg-provider" data-state={c.status === "active" ? "on" : "off"}>
			<IntegrationGlyph slug={c.providerSlug} />
			<div class="stg-provider__text">
				<span class="stg-provider__name">{c.providerLabel}</span>
				<span class="stg-provider__meta">{meta}</span>
				{c.lastError ? <span class="stg-provider__meta">{c.lastError}</span> : null}
				{props.confirming ? <span class="stg-provider__meta">{disconnectWarning(c)}</span> : null}
				{row.canPublish
					? (
						<ToggleSwitch
							size="sm"
							class="stg-provider__publish"
							label="Publish my Projective events to a separate calendar"
							value={publishing}
							disabled={props.locked || props.simulated}
							onValueChange={(on: boolean) => act.publish(c, on)}
						/>
					)
					: null}
			</div>
			<div class="stg-provider__actions">
				{props.confirming
					? (
						<div
							class="stg-emails__confirm"
							role="group"
							aria-label={`Disconnect ${c.providerLabel}?`}
						>
							<span class="stg-emails__ask">Disconnect {c.providerLabel}?</span>
							<Button
								size="sm"
								severity="danger"
								label="Disconnect"
								loading={props.revoking}
								onClick={() => act.disconnect(c)}
							/>
							<Button
								size="sm"
								variant="text"
								severity="secondary"
								label="Keep"
								disabled={props.revoking}
								onClick={act.cancelDisconnect}
							/>
						</div>
					)
					: (
						<div class="stg-emails__actions">
							{row.consent === "none" ? null : (
								<Button
									size="sm"
									variant="outlined"
									severity="neutral"
									label={props.starting === c.providerSlug
										? "Opening…"
										: c.status === "pending"
										? "Finish setup"
										: row.consent === "reconnect"
										? "Reconnect"
										: "Connect again"}
									aria-label={`${
										c.status === "pending"
											? "Finish setting up"
											: row.consent === "reconnect"
											? "Reconnect"
											: "Connect again"
									} ${c.providerLabel}`}
									disabled={props.locked || props.simulated}
									onClick={() => act.connect(c.providerSlug)}
								/>
							)}
							<Button
								size="sm"
								variant="text"
								severity="danger"
								label="Disconnect"
								aria-label={`Disconnect ${c.providerLabel}`}
								disabled={props.locked || props.simulated}
								onClick={() => act.askDisconnect(c)}
							/>
						</div>
					)}
			</div>
		</li>
	);
}
