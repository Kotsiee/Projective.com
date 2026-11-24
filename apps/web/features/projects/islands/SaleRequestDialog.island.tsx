import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/sale-requests.css";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, Checkbox, InputText, NumberStepper, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type {
	ProjectSaleRequests,
	SaleRequestFile,
	SaleRequestView,
} from "@projective/types/catalogue";
import { SaleRequestService } from "../core/SaleRequestService.ts";

/**
 * SaleRequestDialog — a stage's request to sell, from either side (MARKETPLACE SC7, Decision #493;
 * DESIGN_SYSTEM §C.1). Opened by the Overview's "Requests to sell" rows through `?sell=<stage slug>`
 * (ROUTING.md), so the state is a URL and a reload reopens it; closing drops the parameter.
 *
 *  - **The maker** asks: a title, the delivered files it is made of (a file with no whole-file
 *    fingerprint cannot be the link, so it is shown and not offered), a royalty to the client in % of
 *    the seller's net (0 up to the platform's ceiling; none on a shared-ownership stage, which lists at
 *    once), and a note. "Send request" is the one fill. A waiting request can be withdrawn; a granted
 *    one links to its draft; a declined one shows why and may be asked again.
 *  - **The client** decides as proposed, never counters: the files to grant (all by default) and their
 *    own words for the scope, then "Grant"; or "Decline", saying why. ⚖️ While grants wait for counsel
 *    (`grantsEnabled` false) there is no Grant: the dialog says so and offers Decline.
 *
 * Every rule is the server's; the dialog re-reads the page after each act.
 */

// #region Props
/** Props for {@link SaleRequestDialog}. */
export interface SaleRequestDialogProps {
	/** The project's slug, for the page's own address. */
	slug: string;
	sales: ProjectSaleRequests;
	/** The stage `?sell=` names, when the page was opened on it. */
	initialStage: string | null;
}
// #endregion

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function pct(bp: number): string {
	return `${(bp / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} %`;
}

function sizeOf(bytes: number | null): string {
	if (bytes === null) return "";
	return bytes >= 1_000_000
		? `${(bytes / 1_000_000).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Reload the page on this stage, so the server-rendered state follows the act. */
function reloadOn(stageSlug: string): void {
	const url = new URL(globalThis.location.href);
	url.searchParams.set("sell", stageSlug);
	globalThis.location.assign(url.pathname + url.search);
}

export default function SaleRequestDialog(props: SaleRequestDialogProps): JSX.Element | null {
	const { sales, initialStage } = props;
	const stage = sales.stages.find((s) => s.stageSlug === initialStage) ?? null;
	const requests = sales.requests.filter((r) => r.stageSlug === initialStage);
	const current: SaleRequestView | null = requests[0] ?? null;
	const visible = useSignal(Boolean(initialStage && (stage || current)));

	const title = useSignal("");
	const picked = useSignal<string[]>(
		stage?.files.filter((f) => f.sha256).map((f) => f.file_id) ?? [],
	);
	const royalty = useSignal<number | null>(stage?.ipMode === "shared_ownership" ? 0 : 10);
	const note = useSignal("");
	const granted = useSignal<string[]>(current?.files.map((f) => f.file_id) ?? []);
	const declining = useSignal(false);
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);

	if (!initialStage || (!stage && !current)) return null;

	const forget = () => {
		const url = new URL(globalThis.location.href);
		if (!url.searchParams.has("sell")) return;
		url.searchParams.delete("sell");
		globalThis.history.replaceState(globalThis.history.state, "", url);
	};

	const run = async (call: () => Promise<{ ok: boolean; message?: string }>) => {
		busy.value = true;
		error.value = null;
		const out = await call();
		if (out.ok) {
			reloadOn(initialStage);
			return;
		}
		busy.value = false;
		error.value = out.message ?? "That couldn't be done just now.";
	};

	const toggle = (list: typeof picked, id: string, on: boolean) => {
		list.value = on ? [...new Set([...list.value, id])] : list.value.filter((x) => x !== id);
	};

	const fileList = (
		files: SaleRequestFile[],
		list: typeof picked,
		offer: (f: SaleRequestFile) => boolean,
	) => (
		<ul class="sale-dlg__files" aria-label="Files">
			{files.map((f) => (
				<li key={f.file_id} class="sale-dlg__file">
					{offer(f)
						? (
							<Checkbox
								value={list.value.includes(f.file_id)}
								onValueChange={(on) => toggle(list, f.file_id, on === true)}
								label={f.name}
								disabled={busy.value}
							/>
						)
						: <span class="sale-dlg__filename">{f.name}</span>}
					<span class="sale-dlg__meta">
						{[sizeOf(f.bytes), f.sha256 ? null : "No full fingerprint, so it can't be linked"]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</li>
			))}
		</ul>
	);

	// #region The client's side
	const asClient = current?.role === "client";
	const clientBody = asClient && current
		? (
			<div class="sale-dlg__body">
				<p class="sale-dlg__lead">{current.title}</p>
				<p class="sale-dlg__meta">
					{`Made on ${current.stageName} · asked ${DATE.format(new Date(current.createdAt))}`}
				</p>
				{current.note ? <p class="sale-dlg__quote">{current.note}</p> : null}
				<p class="sale-dlg__text">
					{current.royaltyBp > 0
						? `If you grant it, you earn ${
							pct(current.royaltyBp)
						} of what your freelancer earns from every sale, after Projective's commission. The rate is the one asked for; to agree another, decline and say so.`
						: "They ask for no royalty: you would earn nothing from its sales."}
				</p>
				{current.status === "requested" && current.canDecide
					? (
						<>
							{declining.value
								? (
									<Textarea
										value={note}
										rows={3}
										maxLength={2000}
										fluid
										disabled={busy.value}
										aria-label="Why you're declining"
										placeholder="Optional: why, or the rate you'd agree to."
									/>
								)
								: sales.grantsEnabled
								? (
									<>
										<p class="sale-dlg__label">What you grant</p>
										{fileList(current.files, granted, () => true)}
										<Textarea
											value={note}
											rows={2}
											maxLength={2000}
											fluid
											disabled={busy.value}
											aria-label="The scope, in your words"
											placeholder="Optional: the scope in your words, e.g. the layouts but not the logo."
										/>
									</>
								)
								: (
									<InlineNotice
										align="start"
										icon={<Icon name="info" />}
										text="Grants open once Projective's counsel has written the licence a grant creates. You can decline now, or decide later."
									/>
								)}
						</>
					)
					: <p class="sale-dlg__meta">{statusLine(current)}</p>}
			</div>
		)
		: null;

	const clientFoot = asClient && current?.status === "requested" && current.canDecide
		? (
			<div class="sale-dlg__foot">
				{declining.value
					? (
						<>
							<Button
								variant="text"
								label="Back"
								disabled={busy.value}
								onClick={() => (declining.value = false)}
							/>
							<Button
								label="Decline request"
								loading={busy.value}
								onClick={() =>
									void run(() =>
										SaleRequestService.decide(current.id, {
											approve: false,
											note: note.value.trim() || undefined,
										})
									)}
							/>
						</>
					)
					: (
						<>
							<Button
								variant="text"
								label="Decline"
								disabled={busy.value}
								onClick={() => (declining.value = true)}
							/>
							{sales.grantsEnabled
								? (
									<Button
										label="Grant"
										loading={busy.value}
										disabled={granted.value.length === 0}
										onClick={() =>
											void run(() =>
												SaleRequestService.decide(current.id, {
													approve: true,
													fileIds: granted.value,
													note: note.value.trim() || undefined,
												})
											)}
									/>
								)
								: null}
						</>
					)}
			</div>
		)
		: null;
	// #endregion

	// #region The maker's side
	const waiting = !asClient && current?.status === "requested";
	const grantedDraft = !asClient && current?.status === "approved" ? current : null;
	const canAsk = !asClient && stage && !stage.refusal && !stage.openRequest && !grantedDraft;
	const shared = stage?.ipMode === "shared_ownership";
	const maxPct = sales.royaltyMaxBp / 100;
	const ready = title.value.trim().length > 0 && picked.value.length > 0 && royalty.value !== null;

	const makerBody = !asClient
		? (
			<div class="sale-dlg__body">
				{waiting && current
					? (
						<>
							<p class="sale-dlg__lead">{current.title}</p>
							<p class="sale-dlg__meta">
								{`Asked ${DATE.format(new Date(current.createdAt))} · ${
									pct(current.royaltyBp)
								} royalty to the client`}
							</p>
							<p class="sale-dlg__text">
								The client hasn't decided yet. You'll be told when they do.
							</p>
						</>
					)
					: grantedDraft
					? (
						<>
							<p class="sale-dlg__lead">{grantedDraft.title}</p>
							<p class="sale-dlg__meta">{statusLine(grantedDraft)}</p>
							{grantedDraft.scopeNote
								? <p class="sale-dlg__quote">{grantedDraft.scopeNote}</p>
								: null}
							<p class="sale-dlg__text">
								Its draft holds the granted files. Set a price and publish it; it can deliver
								granted files only.
							</p>
						</>
					)
					: canAsk && stage
					? (
						<>
							{current?.status === "declined"
								? (
									<p class="sale-dlg__meta">
										{`The client declined "${current.title}"${
											current.decisionNote ? `: "${current.decisionNote}"` : "."
										}`}
									</p>
								)
								: null}
							<p class="sale-dlg__text">
								{shared
									? `${stage.stageName} was made under shared ownership, so you may sell from it without a grant. Its draft is made at once, and the client is told.`
									: `The work from ${stage.stageName} belongs to the client. Ask them to let you sell it, for a royalty to them on every sale.`}
							</p>
							<InputText
								value={title}
								fluid
								maxLength={200}
								disabled={busy.value}
								aria-label="What you want to sell"
								placeholder="What you want to sell, e.g. a UI kit"
							/>
							<p class="sale-dlg__label">Made of</p>
							{fileList(stage.files, picked, (f) => f.sha256 !== null)}
							{shared ? null : (
								<div class="sale-dlg__royalty">
									<NumberStepper
										value={royalty}
										min={0}
										max={maxPct}
										step={1}
										disabled={busy.value}
										aria-label="Royalty to the client, in percent"
									/>
									<span class="sale-dlg__meta">
										{`% of what you earn from each sale, after Projective's commission (0 to ${maxPct} %)`}
									</span>
								</div>
							)}
							<Textarea
								value={note}
								rows={2}
								maxLength={2000}
								fluid
								disabled={busy.value}
								aria-label="A note to the client"
								placeholder="Optional: a note to the client."
							/>
						</>
					)
					: <p class="sale-dlg__text">{stage?.refusal ?? (current ? statusLine(current) : "")}</p>}
			</div>
		)
		: null;

	const makerFoot = !asClient
		? (
			<div class="sale-dlg__foot">
				{waiting && current?.canWithdraw
					? (
						<Button
							variant="text"
							label="Withdraw request"
							loading={busy.value}
							onClick={() => void run(() => SaleRequestService.withdraw(current.id))}
						/>
					)
					: null}
				{grantedDraft?.productSlug
					? (
						<a
							class="sale-dlg__link"
							href={`/catalogue/${encodeURIComponent(grantedDraft.productSlug)}`}
						>
							Open the draft
						</a>
					)
					: null}
				{canAsk && stage
					? (
						<Button
							label={shared ? "Create the draft" : "Send request"}
							loading={busy.value}
							disabled={!ready}
							onClick={() =>
								void run(() =>
									SaleRequestService.request({
										stageId: stage.stageId,
										title: title.value.trim(),
										fileIds: picked.value,
										royaltyBp: shared ? 0 : Math.round((royalty.value ?? 0) * 100),
										note: note.value.trim(),
									})
								)}
						/>
					)
					: null}
			</div>
		)
		: null;
	// #endregion

	return (
		<Dialog
			visible={visible}
			modal
			header={asClient ? "A request to sell" : "Sell work from this stage"}
			footer={(asClient ? clientFoot : makerFoot) ?? undefined}
			width="var(--overlay-w-md)"
			closable={!busy.value}
			closeOnEscape={!busy.value}
			dismissableMask={!busy.value}
			onVisibleChange={(open) => {
				if (!open) forget();
			}}
		>
			{asClient ? clientBody : makerBody}
			{error.value
				? <InlineNotice align="start" icon={<Icon name="warning" />} text={error.value} assertive />
				: null}
		</Dialog>
	);
}

/** Where a decided or closed request stands, as one meta line. */
function statusLine(r: SaleRequestView): string {
	const when = r.decidedAt ? ` ${DATE.format(new Date(r.decidedAt))}` : "";
	switch (r.status) {
		case "approved":
			return `Granted${when} · ${pct(r.royaltyBp)} royalty to the client`;
		case "declined":
			return `Declined${when}`;
		case "withdrawn":
			return "Withdrawn";
		case "requested":
			return "Waiting for the client";
	}
}
