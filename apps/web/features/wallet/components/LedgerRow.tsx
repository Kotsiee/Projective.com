import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { personFallbackImage } from "@web/components/UserAvatar.tsx";
import { profileHref } from "@features/projects/core/routing.ts";
import type { LedgerLine, LedgerPartyKind } from "../types/wallet-types.ts";
import { methodName } from "../core/wallet-home.ts";
import { isElsewhere, settlementLabel } from "../core/wallet-model.ts";
import { CategoryIcon } from "./wallet-glyphs.tsx";

/** Props for {@link LedgerRow}. */
export interface LedgerRowProps {
	line: LedgerLine;
	/** Whether the island has hydrated; a local clock time is only drawn once the browser's zone is known. */
	mounted: boolean;
	onOpen: (line: LedgerLine) => void;
}

const PARTY_NOUN: Readonly<Record<LedgerPartyKind, string>> = {
	user: "Person",
	team: "Team",
	business: "Business",
};

const TIME = typeof Intl !== "undefined"
	? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })
	: null;

/** "14:32" for a line filed under Today or Yesterday (once hydrated), else the server's date label. */
function whenOf(line: LedgerLine, mounted: boolean): string | null {
	const recent = line.group === "Today" || line.group === "Yesterday";
	if (!recent) return line.dateLabel;
	if (!mounted || !TIME) return null;
	const at = Date.parse(line.at);
	return Number.isFinite(at) ? TIME.format(at) : null;
}

/** Middot-separated inline meta — non-actionable facts are text, never tags (§B.11). */
function Meta({ parts }: { parts: (JSX.Element | string | null | false)[] }): JSX.Element {
	const shown = parts.filter((p): p is JSX.Element | string => !!p);
	return (
		<span class="wlt-lrow__meta">
			{shown.map((part, i) => (
				<span key={i} class="wlt-lrow__part">
					{i > 0 && <span class="wlt-dot" aria-hidden="true">·</span>}
					{part}
				</span>
			))}
		</span>
	);
}

/**
 * One ledger line, dense: the counterparty's face (or the line's category glyph when there is none),
 * the title, then — as one middot line of secondary text — who it was with (name, `@handle`, and what
 * kind of party), what it was about (linked when it has an address), the card that paid, and when.
 * The trailing column carries the signed amount, its settlement state when it is not simply cleared
 * (a lifecycle status, so it may wear a container — §3 gate 7), and the invoice PDF where one exists.
 *
 * The row opens its detail dialog through ONE button stretched across it; the links inside it sit
 * above that stretch, so nothing interactive is nested inside anything interactive.
 */
export function LedgerRow({ line, mounted, onOpen }: LedgerRowProps): JSX.Element {
	const credit = line.direction === "credit";
	const kind = line.counterpartyKind;
	const handle = line.counterpartyHandle;
	const party = line.counterparty
		? (
			<span class="wlt-lrow__party">
				{kind === "user" && handle
					? <a class="wlt-lrow__link" href={profileHref(handle)}>{line.counterparty}</a>
					: line.counterparty}
				{handle && <span class="wlt-lrow__handle">@{handle}</span>}
				{kind && kind !== "user" && <span class="wlt-lrow__kind">{PARTY_NOUN[kind]}</span>}
			</span>
		)
		: null;
	const subject = line.subject
		? isElsewhere(line.subject.href)
			? <a class="wlt-lrow__link" href={line.subject.href}>{line.subject.label}</a>
			: line.subject.label
		: null;
	const card = line.instrument
		? methodName({ label: null, brand: line.instrument.brand, last4: line.instrument.last4 })
		: null;

	return (
		<div class="wlt-lrow" data-direction={line.direction} data-settlement={line.settlement}>
			<span class="wlt-lrow__lead" aria-hidden="true">
				{line.counterparty
					? (
						<Avatar
							image={line.counterpartyAvatar ?? undefined}
							fallbackImage={personFallbackImage(kind)}
							label={line.counterparty}
							shape={kind === "user" ? "circle" : "square"}
							size={40}
						/>
					)
					: (
						<span class="wlt-lrow__mark" data-category={line.category}>
							<CategoryIcon category={line.category} size="sm" />
						</span>
					)}
			</span>
			<span class="wlt-lrow__body">
				<button type="button" class="wlt-lrow__open" onClick={() => onOpen(line)}>
					<span class="wlt-lrow__title">{line.title}</span>
				</button>
				<Meta
					parts={[
						party,
						subject && <span key="subject" class="wlt-lrow__subject">{subject}</span>,
						card && <span key="card" class="wlt-lrow__card">{card}</span>,
						whenOf(line, mounted),
					]}
				/>
			</span>
			<span class="wlt-lrow__trail">
				<MoneyView
					value={line.amount}
					size="body"
					sign={credit ? "+" : "−"}
					tone={credit ? "credit" : "default"}
					hideOrigin
					class="wlt-lrow__amount"
				/>
				{(line.settlement !== "cleared" || line.receiptHref) && (
					<span class="wlt-lrow__facts">
						{line.settlement !== "cleared" && (
							<span class="wlt-status" data-settlement={line.settlement}>
								<Icon name={line.settlement === "disputed" ? "warning" : "clock"} size="2xs" />
								{settlementLabel(line.settlement)}
							</span>
						)}
						{line.receiptHref && (
							<Tooltip content="Invoice PDF">
								<a
									class="wlt-iconbtn wlt-lrow__receipt"
									href={line.receiptHref}
									aria-label={`Invoice PDF for ${line.title}`}
								>
									<Icon name="document" size="xs" />
								</a>
							</Tooltip>
						)}
					</span>
				)}
			</span>
		</div>
	);
}
