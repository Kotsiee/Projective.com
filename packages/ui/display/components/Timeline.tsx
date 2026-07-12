import type { JSX, VNode } from "preact";
import "../styles/timeline.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

// #region Types
/**
 * A single point on a {@link Timeline}. Everything is optional so callers can render as little as a
 * bare marker or as much as dated, coloured, icon-led content.
 */
export interface TimelineEvent<T = unknown> {
	/** Short status/title for the event (rendered above content when no `contentTemplate`). */
	status?: string;
	/** Date/time label (rendered muted; also the default opposite-side text). */
	date?: string;
	/** Icon token/name shown inside the marker (kept a string to stay library-agnostic). */
	icon?: string;
	/** Accent colour token reference for this event's marker (e.g. `"var(--success)"`). */
	color?: string;
	/** Main content for the event. */
	content?: VNode | string;
	/** Arbitrary caller payload echoed into the template callbacks. */
	data?: T;
}

/** Which side the content sits on (vertical) / above-or-below (horizontal). */
export type TimelineAlign = "left" | "right" | "alternate";

/** Primary axis of the timeline. */
export type TimelineLayout = "vertical" | "horizontal";

/** Props for {@link Timeline}. */
export interface TimelineProps<T = unknown> {
	/** The ordered events. */
	value: TimelineEvent<T>[];
	/** Content side (default `left`). `alternate` zig-zags sides down the line. */
	align?: TimelineAlign;
	/** Primary axis (default `vertical`). */
	layout?: TimelineLayout;
	/** Custom marker renderer; defaults to a token dot (with `icon` if provided). */
	markerTemplate?: (event: TimelineEvent<T>, index: number) => VNode;
	/** Custom content renderer; defaults to `status` + `content`. */
	contentTemplate?: (event: TimelineEvent<T>, index: number) => VNode;
	/** Renderer for the opposite side (e.g. the date). Enables the opposite column when present. */
	oppositeTemplate?: (event: TimelineEvent<T>, index: number) => VNode;
	/** Accessible label for the list. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * Timeline — a connector line threading a sequence of event markers with content. Zero client JS.
 * Supports `vertical` / `horizontal` layouts and `left` / `right` / `alternate` alignment, with
 * `markerTemplate`, `contentTemplate`, and `oppositeTemplate` render slots. The connector and markers
 * are token-driven; per-event `color` recolours the marker. Rendered as an ordered `role="list"` of
 * `role="listitem"` events for assistive tech.
 */
export function Timeline<T = unknown>(props: TimelineProps<T>): JSX.Element {
	const {
		value,
		align = "left",
		layout = "vertical",
		markerTemplate,
		contentTemplate,
		oppositeTemplate,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const hasOpposite = !!oppositeTemplate || align === "alternate";

	const renderMarker = (event: TimelineEvent<T>, index: number): VNode =>
		markerTemplate ? markerTemplate(event, index) : (
			<span class="ui-timeline__marker" aria-hidden="true">
				{event.icon ?? ""}
			</span>
		);

	const renderContent = (event: TimelineEvent<T>, index: number): VNode =>
		contentTemplate ? contentTemplate(event, index) : (
			<>
				{event.date && <div class="ui-timeline__date">{event.date}</div>}
				{event.status && <strong>{event.status}</strong>}
				{event.content && <div>{event.content}</div>}
			</>
		);

	return (
		<ol
			class={cx(
				"ui-timeline",
				`ui-timeline--${layout}`,
				align === "right" && "ui-timeline--right",
				align === "alternate" && "ui-timeline--alternate",
				hasOpposite && "ui-timeline--opposite",
				className,
			)}
			aria-label={ariaLabel}
		>
			{value.map((event, index) => {
				const side = align === "alternate" ? (index % 2 === 0 ? "left" : "right") : align;
				const opposite = oppositeTemplate
					? oppositeTemplate(event, index)
					: align === "alternate" && event.date
					? <div class="ui-timeline__date">{event.date}</div>
					: null;
				return (
					<li
						key={index}
						class={cx(
							"ui-timeline__event",
							side === "right" && "ui-timeline__event--right",
							side === "left" && "ui-timeline__event--left",
							layout === "horizontal" && index % 2 === 0 && "ui-timeline__event--top",
						)}
						style={event.color ? styleVars({ "--tl-color": event.color }) : undefined}
					>
						{hasOpposite && <div class="ui-timeline__opposite">{opposite}</div>}
						<div class="ui-timeline__separator">
							{renderMarker(event, index)}
							<span class="ui-timeline__connector" aria-hidden="true" />
						</div>
						<div class="ui-timeline__content">{renderContent(event, index)}</div>
					</li>
				);
			})}
		</ol>
	);
}
