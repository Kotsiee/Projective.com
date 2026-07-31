import type { JSX, VNode } from "preact";
import "../styles/breadcrumb.css";
import { cx } from "../../core/cx.ts";
import type { MenuItem } from "../../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link Breadcrumb}. */
export interface BreadcrumbProps {
	/** Trail nodes, root-to-leaf order. The last node is the current page unless it carries its own `url`. */
	model: MenuItem[];
	/** Optional leading node (typically an icon-only "home" crumb), rendered before `model`. */
	home?: MenuItem;
	/** Separator glyph between crumbs (default `"chevron"`). Ignored when `separatorTemplate` is set. */
	separator?: "slash" | "chevron";
	/** Custom separator renderer, replacing the default glyph. */
	separatorTemplate?: () => VNode | string;
	/** Custom per-item renderer (icon/label composition). Receives the item and its trail index. */
	itemTemplate?: (item: MenuItem, index: number) => VNode;
	/** Accessible label for the `nav` landmark (default `"Breadcrumb"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Defaults
function defaultSeparator(kind: "slash" | "chevron"): VNode {
	return (
		<span class="ui-breadcrumb__sep-glyph" aria-hidden="true">
			{kind === "slash" ? "/" : <Icon name="chevron-right" />}
		</span>
	);
}

function defaultItem(item: MenuItem): VNode {
	return (
		<>
			{item.icon && <span class="ui-breadcrumb__icon" aria-hidden="true">{item.icon}</span>}
			{item.label && <span class="ui-breadcrumb__label">{item.label}</span>}
		</>
	);
}

/** A trail node is always shown (never collapsed) at the root, and at the trailing two positions. */
function alwaysVisible(index: number, lastIndex: number): boolean {
	return index === 0 || index >= lastIndex - 1;
}
// #endregion

/**
 * Breadcrumb — a zero-JS wayfinding trail built from a {@link MenuItem} `model` (+ optional leading
 * `home` node). Renders `role="navigation"` around an ordered list; every crumb but the last is an
 * anchor, the last one is a plain `<span aria-current="page">` (unless it carries its own `url`, e.g.
 * a "you are here, but also linkable" crumb). Middle crumbs collapse behind a single CSS-only `…`
 * marker under narrow widths — no JS measurement, just a breakpoint swap between the full list and
 * the first/ellipsis/last-two skeleton, so the component stays a pure server component.
 *
 * A crumb may carry a {@link MenuItem.command} for **client-driven** trails (e.g. an in-place tree
 * navigator that updates a signal instead of doing a full navigation): the crumb still renders an
 * anchor (so the `url` remains deep-linkable + middle-click-openable), but a plain left-click is
 * intercepted — `preventDefault` then `command` — so the host handles it without a page load. Crumbs
 * with no `command` keep the pure-anchor behaviour, so existing usages are byte-identical.
 */
export function Breadcrumb(props: BreadcrumbProps): JSX.Element {
	const {
		model,
		home,
		separator = "chevron",
		separatorTemplate,
		itemTemplate,
		"aria-label": ariaLabel = "Breadcrumb",
		class: className,
	} = props;

	const trail: MenuItem[] = home ? [home, ...model] : model;
	const lastIndex = trail.length - 1;
	const hasCollapsible = trail.length > 3;

	// #region Row builders
	const renderSeparator = (key: string, collapsible: boolean): VNode => (
		<li
			key={key}
			class={cx("ui-breadcrumb__sep", collapsible && "ui-breadcrumb__sep--collapsible")}
			role="presentation"
			aria-hidden="true"
		>
			{separatorTemplate ? separatorTemplate() : defaultSeparator(separator)}
		</li>
	);

	const renderCrumb = (item: MenuItem, index: number): VNode => {
		const isLast = index === lastIndex;
		const isCurrent = isLast && !item.url;
		const content = itemTemplate ? itemTemplate(item, index) : defaultItem(item);
		const collapsible = hasCollapsible && !alwaysVisible(index, lastIndex);

		return (
			<li
				key={item.key ?? item.label ?? index}
				class={cx(
					"ui-breadcrumb__item",
					collapsible && "ui-breadcrumb__item--collapsible",
					item.class,
				)}
			>
				{isCurrent
					? (
						<span class="ui-breadcrumb__crumb ui-breadcrumb__crumb--current" aria-current="page">
							{content}
						</span>
					)
					: (
						<a
							class="ui-breadcrumb__crumb"
							href={item.url ?? "#"}
							target={item.target}
							aria-current={isLast ? "page" : undefined}
							onClick={item.command
								? (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
									// Let modified clicks (new tab / download) fall through to the anchor.
									if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
									e.preventDefault();
									item.command!({ item, originalEvent: e });
								}
								: undefined}
						>
							{content}
						</a>
					)}
			</li>
		);
	};
	// #endregion

	const rows: VNode[] = [];
	trail.forEach((item, i) => {
		if (i > 0) {
			const sepCollapsible = hasCollapsible &&
				!alwaysVisible(i - 1, lastIndex) &&
				!alwaysVisible(i, lastIndex);
			rows.push(renderSeparator(`sep-${i}`, sepCollapsible));
		}
		if (i === 1 && hasCollapsible) {
			rows.push(
				<li
					key="ellipsis"
					class="ui-breadcrumb__item ui-breadcrumb__item--ellipsis"
					role="presentation"
					aria-hidden="true"
				>
					<span class="ui-breadcrumb__crumb ui-breadcrumb__crumb--ellipsis">…</span>
				</li>,
			);
		}
		rows.push(renderCrumb(item, i));
	});

	return (
		<nav class={cx("ui-breadcrumb", className)} aria-label={ariaLabel}>
			<ol class="ui-breadcrumb__list">{rows}</ol>
		</nav>
	);
}
