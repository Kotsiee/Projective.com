import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { DATA_EXPORT_POLICY, type DataExportState } from "@projective/types/org";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SettingsBlock,
	SettingsRow,
} from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";
import { longDate } from "../../../core/settings-dates.ts";
import {
	archiveSize,
	DATA_EXPORT_FAILURE_COPY,
	DATA_EXPORT_SIGN_IN_HREF,
	DATA_EXPORT_UNAVAILABLE_PARAM,
	dataExportView,
	type NextRequest,
} from "../../../core/data-export-model.ts";

/** Props for {@link DataExportBlock}. */
export interface DataExportBlockProps {
	dataExport: Signal<DataExportState | null>;
	locale: string;
}

const DOWNLOAD_HREF = "/api/user/data-export/download";

const LEDE =
	`A ZIP of what your account holds: your profile, projects, the messages you sent, wallet history, reviews and more, with a list of your files. We'll prepare it and you can download it for ${DATA_EXPORT_POLICY.linkDays} days.`;

function takeUnavailable(): boolean {
	if (typeof location === "undefined") return false;
	const url = new URL(location.href);
	if (url.searchParams.get("export") !== DATA_EXPORT_UNAVAILABLE_PARAM) return false;
	url.searchParams.delete("export");
	const state = history.state && typeof history.state === "object" ? history.state : {};
	history.replaceState(
		{ ...state, fClientNav: false },
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
	return true;
}

function When(props: { iso: string; locale: string }): JSX.Element {
	return <time class="stg-tabular" dateTime={props.iso}>{longDate(props.iso, props.locale)}</time>;
}

/**
 * Download your data (Decision #450) — asks for a copy of everything the account holds, says while
 * it is being prepared, and offers the download until it expires. Every rule (a recent sign-in, one
 * a day, none while an erasure is scheduled) is the server's; the block renders its answer.
 */
export function DataExportBlock(props: DataExportBlockProps): JSX.Element {
	const status = useSignal<SaveState>(IDLE);
	const busy = useSignal(false);
	const view = dataExportView(props.dataExport.value, new Date());

	useEffect(() => {
		if (takeUnavailable()) {
			status.value = {
				tone: "error",
				text: "That copy is no longer available. Ask for a new one.",
			};
		}
	}, []);

	async function refresh(): Promise<void> {
		const res = await SettingsService.dataExport();
		if (res.ok) props.dataExport.value = res.data.dataExport;
	}

	async function request(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		status.value = { tone: "busy", text: "Sending your request…" };
		const res = await SettingsService.requestDataExport();
		busy.value = false;
		if (res.ok) {
			props.dataExport.value = res.data.dataExport;
			status.value = { tone: "saved", text: res.message ?? "We're preparing your copy." };
			return;
		}
		status.value = { tone: "error", text: res.message };
		await refresh();
	}

	async function checkAgain(): Promise<void> {
		status.value = { tone: "busy", text: "Checking…" };
		await refresh();
		status.value = IDLE;
	}

	function requestControl(next: NextRequest, label: string): JSX.Element | null {
		if (next.closing || next.at) return null;
		if (next.needsSignIn) {
			return (
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
					href={DATA_EXPORT_SIGN_IN_HREF}
				>
					<span class="ui-button__label">Sign in to {label.toLowerCase()}</span>
				</a>
			);
		}
		return (
			<Button
				severity="neutral"
				variant="outlined"
				size="sm"
				label={label}
				aria-busy={busy.value ? "true" : undefined}
				onClick={request}
			/>
		);
	}

	function nextNote(next: NextRequest): JSX.Element | null {
		if (next.closing) return null;
		if (next.at) {
			return (
				<>
					You can ask for another copy on <When iso={next.at} locale={props.locale} />.
				</>
			);
		}
		return next.needsSignIn ? <>For your security, you'll sign in again first.</> : null;
	}

	let body: JSX.Element;
	switch (view.kind) {
		case "unavailable":
			body = (
				<InlineNotice align="start" text="Your data copy's status couldn't be read just now." />
			);
			break;
		case "closing":
			body = (
				<SettingsRow
					label="Download your data"
					description="Your account is scheduled for deletion, so a new copy can't be prepared. Keep your account below to ask for one."
					control={null}
				/>
			);
			break;
		case "preparing":
			body = (
				<SettingsRow
					label="Preparing your copy"
					description={
						<>
							Asked for on{" "}
							<When iso={view.requestedAt} locale={props.locale} />. We'll tell you here when it's
							ready to download.
						</>
					}
					control={
						<Button
							variant="text"
							severity="secondary"
							size="sm"
							label="Check again"
							onClick={checkAgain}
						/>
					}
				/>
			);
			break;
		case "ready": {
			const size = archiveSize(view.byteSize, props.locale);
			const note = nextNote(view.next);
			body = (
				<>
					<SettingsRow
						label="Your copy is ready"
						description={
							<>
								{size ? <>{size} ·</> : null}Download it by{" "}
								<When iso={view.expiresAt} locale={props.locale} />.
							</>
						}
						control={
							<a
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
								href={DOWNLOAD_HREF}
							>
								<span class="ui-button__label">Download</span>
							</a>
						}
					/>
					{view.next.closing ? null : (
						<SettingsRow
							label="A newer copy"
							description={note ?? "Ask again if your data has changed since."}
							control={requestControl(view.next, "Ask again")}
						/>
					)}
				</>
			);
			break;
		}
		case "request": {
			const last = view.last === "failed" && view.failureReason
				? DATA_EXPORT_FAILURE_COPY[view.failureReason]
				: view.last === "expired"
				? "Your last copy has expired."
				: null;
			const note = nextNote(view.next);
			body = (
				<SettingsRow
					label="Download your data"
					description={last || note ? <>{last}{last && note ? " " : null}{note}</> : undefined}
					control={requestControl(view.next, "Request a copy")}
				/>
			);
			break;
		}
	}

	return (
		<SettingsBlock anchor="data-export" title="Download your data" description={LEDE}>
			{body}
			<SaveStatus state={status.value} />
		</SettingsBlock>
	);
}
