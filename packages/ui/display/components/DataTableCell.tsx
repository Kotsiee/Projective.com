import type { JSX, VNode } from "preact";
import { Icon } from "../../icons/mod.ts";
import { Avatar } from "./Avatar.tsx";
import { AvatarStack } from "./AvatarStack.tsx";
import { type MoneyTone, MoneyView } from "./MoneyView.tsx";
import { ProgressiveImage } from "./ProgressiveImage.tsx";
import { Tag } from "./Tag.tsx";
import type { DataColumn, DateFormat, ImageCellValue, MoneyFlow } from "../types/data-table.ts";
import {
	formatBytes,
	formatDate,
	formatDateFull,
	formatDuration,
	formatNumber,
	formatRating,
	toEpoch,
} from "../core/table-format.ts";
import { highlightParts } from "../core/table-filter.ts";

/** Formatting context shared by every cell of one table render. */
export interface CellContext {
	locale: string;
	timeZone?: string;
	/** One instant per render, so every relative date on the page is measured from the same now. */
	now: number;
	/** Whether rows are tall enough for a `file` cell to show its thumbnail instead of its glyph. */
	showThumbs: boolean;
	/** App-supplied date formatting (an enterprise's date preference), used instead of `Intl` defaults. */
	formatDate?: (ms: number, format: DateFormat) => string;
	/** The stand-in picture for a person without one. */
	avatarFallback?: string;
}

const FLOW_TONE: Record<MoneyFlow, MoneyTone> = {
	standard: "default",
	income: "credit",
	outgoing: "debit",
};
const FLOW_SIGN: Record<MoneyFlow, "+" | "−" | null> = {
	standard: null,
	income: "+",
	outgoing: "−",
};

function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
	if (!query) return <>{text}</>;
	return (
		<>
			{highlightParts(text, query).map((part, i) =>
				part.match ? <mark key={i} class="ui-dt__mark">{part.text}</mark> : part.text
			)}
		</>
	);
}

function Empty(): JSX.Element {
	return <span class="ui-dt__empty">–</span>;
}

function Thumb(
	{ image, fallback, kind }: { image: ImageCellValue; fallback: VNode; kind: "file" | "image" },
): JSX.Element {
	return (
		<span class={`ui-dt__thumb ui-dt__thumb--${kind}`}>
			<ProgressiveImage
				src={image.src}
				alt={image.alt ?? ""}
				placeholder={image.placeholder}
				loading="lazy"
				draggable={false}
				fallback={fallback}
			/>
		</span>
	);
}

function renderValue<T>(column: DataColumn<T>, row: T, ctx: CellContext, query: string) {
	switch (column.type) {
		case "text": {
			const text = column.value(row);
			const secondary = column.secondary?.(row);
			const lead = column.lead?.(row);
			if (!text && !secondary) return <Empty />;
			const main = (
				<span class="ui-dt__text" title={text ?? undefined}>
					<Highlight text={text ?? ""} query={query} />
				</span>
			);
			return (
				<>
					{lead ? <span class="ui-dt__lead-mark" aria-hidden="true">{lead}</span> : null}
					{secondary
						? (
							<span class="ui-dt__stack">
								{main}
								<span class="ui-dt__sub">{secondary}</span>
							</span>
						)
						: main}
				</>
			);
		}
		case "number": {
			const n = column.value(row);
			return n == null ? <Empty /> : (
				<span class="ui-dt__num">
					{formatNumber(n, column.format ?? "integer", ctx.locale, column.digits)}
				</span>
			);
		}
		case "date": {
			const ms = toEpoch(column.value(row));
			if (ms == null) return <Empty />;
			const format = column.format ?? "datetime";
			const label = ctx.formatDate?.(ms, format) ??
				formatDate(ms, format, ctx.locale, ctx.now, ctx.timeZone);
			return (
				<time
					class="ui-dt__num"
					dateTime={new Date(ms).toISOString()}
					title={formatDateFull(ms, ctx.locale, ctx.timeZone)}
				>
					{label}
				</time>
			);
		}
		case "file": {
			const file = column.value(row);
			const showThumb = file.thumb && ctx.showThumbs;
			return (
				<>
					{showThumb && file.thumb
						? <Thumb image={file.thumb} fallback={file.icon} kind="file" />
						: <span class="ui-dt__thumb ui-dt__thumb--file">{file.icon}</span>}
					<span class="ui-dt__name" title={file.name}>
						<Highlight text={file.name} query={query} />
					</span>
					{file.meta ? <span class="ui-dt__meta">{file.meta}</span> : null}
				</>
			);
		}
		case "fileSize": {
			const bytes = column.value(row);
			return bytes == null
				? <Empty />
				: <span class="ui-dt__num">{formatBytes(bytes, ctx.locale)}</span>;
		}
		case "image": {
			const image = column.value(row);
			return image
				? <Thumb image={image} fallback={<Icon name="image" />} kind="image" />
				: (
					<span class="ui-dt__thumb ui-dt__thumb--image">
						<Icon name="image" />
					</span>
				);
		}
		case "status": {
			const status = column.value(row);
			return status
				? (
					<Tag
						value={status.label}
						severity={status.tone}
						variant="subtle"
						rounded
						icon={status.icon}
					/>
				)
				: <Empty />;
		}
		case "tags": {
			const tags = column.value(row);
			if (tags.length === 0) return <Empty />;
			return (
				<span class="ui-dt__text" title={tags.join(", ")}>
					{tags.map((tag, i) => (
						<span key={tag}>
							{i > 0 ? <span class="ui-dt__dot" aria-hidden="true">·</span> : null}
							<Highlight text={tag} query={query} />
						</span>
					))}
				</span>
			);
		}
		case "money": {
			const money = column.value(row);
			if (!money) return <Empty />;
			const flow = typeof column.flow === "function" ? column.flow(row) : column.flow ?? "standard";
			return (
				<MoneyView
					minor={money.minor}
					currency={money.currency}
					size="micro"
					tone={FLOW_TONE[flow]}
					sign={FLOW_SIGN[flow]}
					hideOrigin={column.hideOrigin}
				/>
			);
		}
		case "person": {
			const person = column.value(row);
			if (!person) {
				const fallback = column.fallback?.(row);
				return fallback ? <span class="ui-dt__text">{fallback}</span> : <Empty />;
			}
			return (
				<>
					<Avatar
						image={person.avatar}
						fallbackImage={ctx.avatarFallback}
						label={person.name}
						size={20}
						alt=""
					/>
					<span class="ui-dt__text" title={person.name}>
						<Highlight text={person.name} query={query} />
					</span>
				</>
			);
		}
		case "people": {
			const people = column.value(row);
			if (people.length === 0) return <Empty />;
			return (
				<span class="ui-dt__people" title={people.map((p) => p.name).join(", ")}>
					<AvatarStack
						people={people}
						max={column.max ?? 4}
						size={24}
						ringColor="var(--dt-row-bg)"
						fallbackImage={ctx.avatarFallback}
					/>
				</span>
			);
		}
		case "rating": {
			const rating = column.value(row);
			if (rating.average == null || rating.count === 0) {
				return <span class="ui-dt__sub">No reviews</span>;
			}
			return (
				<span class="ui-dt__rating">
					<Icon name="star" filled class="ui-dt__star" />
					<span class="ui-dt__num">{formatRating(rating.average, ctx.locale)}</span>
					<span class="ui-dt__sub ui-dt__num">
						({formatNumber(rating.count, "compact", ctx.locale)})
					</span>
				</span>
			);
		}
		case "duration": {
			const ms = column.value(row);
			return ms == null ? <Empty /> : <span class="ui-dt__num">{formatDuration(ms)}</span>;
		}
		case "boolean":
			return column.value(row)
				? (
					<>
						<Icon name="check" class="ui-dt__bool" />
						<span class="ui-visually-hidden">Yes</span>
					</>
				)
				: (
					<>
						<span class="ui-dt__empty" aria-hidden="true">–</span>
						<span class="ui-visually-hidden">No</span>
					</>
				);
		case "custom":
			return column.render(row) ?? <Empty />;
	}
}

/** Props for {@link DataTableCell}. */
export interface DataTableCellProps<T> {
	column: DataColumn<T>;
	row: T;
	ctx: CellContext;
	/** Active text-filter query for this column, highlighted in the cell. */
	query: string;
	align: string;
	/** Sticky inline offset, px, for a pinned column; `null` scrolls with the rest. */
	pin: number | null;
	/** The row's first data cell, which carries its name in the primary text colour. */
	primary: boolean;
	colIndex: number;
}

/** One body cell: the column type picks the formatter. */
export function DataTableCell<T>(props: DataTableCellProps<T>): JSX.Element {
	const { column, row, ctx, query, align, pin, primary, colIndex } = props;
	return (
		<div
			class="ui-dt__cell"
			role="gridcell"
			aria-colindex={colIndex}
			data-col={column.id}
			data-type={column.type}
			data-align={align}
			data-pinned={pin === null ? undefined : "true"}
			data-primary={primary ? "true" : undefined}
			style={pin === null ? undefined : `--dt-pin:${pin}px`}
		>
			{renderValue(column, row, ctx, query)}
		</div>
	);
}
