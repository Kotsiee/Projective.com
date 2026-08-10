/**
 * @projective/ui/display — data & content display.
 *
 * Roster (DESIGN_SYSTEM.md §C.1, expanded for PrimeNG parity): high-performance collections
 * (Table, TreeTable, Tree, DataView, VirtualScroller, Scroller) that virtualize rows via
 * `@projective/ui/hooks/useVirtualScroll` and scroll within their own container OR the window;
 * hierarchical + temporal views (OrgChart, Timeline); media (Image, Galleria, Carousel, GMap); and
 * content atoms (Card, Badge, Tag, Avatar, AvatarGroup, Chip, List, ListItem, Accordion).
 *
 * Styling contract: Pure CSS + strict BEM, token-only. Interactive pieces are islands; atoms are
 * zero-JS server components.
 */

// #region Collections
export { Table } from "./islands/Table.tsx";
export type { TableProps, TableSelectionMode } from "./islands/Table.tsx";
export { TreeTable } from "./islands/TreeTable.tsx";
export type { TreeTableProps } from "./islands/TreeTable.tsx";
export { Tree } from "./islands/Tree.tsx";
export type {
	TreeDropEvent,
	TreeDropPosition,
	TreeProps,
	TreeSelectionMode,
} from "./islands/Tree.tsx";
export type { ColumnAlign, TableColumn } from "./types/mod.ts";
export { DataView } from "./islands/DataView.tsx";
export type { DataViewLayout, DataViewProps, DataViewSortOption } from "./islands/DataView.tsx";
export { VirtualScroller } from "./islands/VirtualScroller.tsx";
export type {
	VirtualScrollerItemContext,
	VirtualScrollerOrientation,
	VirtualScrollerProps,
	VirtualScrollerRange,
} from "./islands/VirtualScroller.tsx";
export { Scroller } from "./islands/Scroller.tsx";
export type {
	ScrollerContentMode,
	ScrollerHandle,
	ScrollerPosition,
	ScrollerProps,
} from "./islands/Scroller.tsx";
export { VirtualGrid } from "./islands/VirtualGrid.tsx";
export type { VirtualGridProps } from "./islands/VirtualGrid.tsx";
// #endregion

// #region Hierarchy & time
export { OrgChart } from "./islands/OrgChart.tsx";
export type { OrgChartProps } from "./islands/OrgChart.tsx";
export { Timeline } from "./components/Timeline.tsx";
export type {
	TimelineAlign,
	TimelineEvent,
	TimelineLayout,
	TimelineProps,
} from "./components/Timeline.tsx";
// #endregion

// #region Media
export { Image } from "./islands/Image.tsx";
export type { ImageProps } from "./islands/Image.tsx";
export { Galleria } from "./islands/Galleria.tsx";
export type {
	GalleriaIndicatorsPosition,
	GalleriaItem,
	GalleriaProps,
	GalleriaThumbnailsPosition,
} from "./islands/Galleria.tsx";
export { Carousel } from "./islands/Carousel.tsx";
export type { CarouselProps, CarouselResponsiveOption } from "./islands/Carousel.tsx";
export { GMap } from "./islands/GMap.tsx";
export type { GMapCenter, GMapMarker, GMapProps, GMapUrlContext } from "./islands/GMap.tsx";
export { AudioVisualizer } from "./islands/AudioVisualizer.tsx";
export type { AudioVisualizerProps } from "./islands/AudioVisualizer.tsx";
export { drawWaveform, formatClock, resamplePeaks } from "./core/audio.ts";
export type { DrawWaveformOptions } from "./core/audio.ts";
// #endregion

// #region Content atoms
export { Card } from "./components/Card.tsx";
export type { CardProps, CardVariant } from "./components/Card.tsx";
export { Badge, OverlayBadge } from "./components/Badge.tsx";
export type { BadgeProps, OverlayBadgeProps } from "./components/Badge.tsx";
export { RatingStars } from "./components/RatingStars.tsx";
export type { RatingStarsProps } from "./components/RatingStars.tsx";
export { Tag } from "./components/Tag.tsx";
export type { TagProps, TagVariant } from "./components/Tag.tsx";
export { Avatar } from "./components/Avatar.tsx";
export type { AvatarProps, AvatarShape, AvatarSize } from "./components/Avatar.tsx";
export { AvatarGroup } from "./components/AvatarGroup.tsx";
export type { AvatarGroupProps } from "./components/AvatarGroup.tsx";
export { AvatarStack } from "./components/AvatarStack.tsx";
export type { AvatarStackPerson, AvatarStackProps } from "./components/AvatarStack.tsx";
export { Chip } from "./components/Chip.tsx";
export type { ChipProps } from "./components/Chip.tsx";
export { MoneyView } from "./components/MoneyView.tsx";
export type { MoneySize, MoneyTone, MoneyViewProps } from "./components/MoneyView.tsx";
export {
	BASE_CURRENCY,
	BASE_LOCALE,
	bootstrapCurrency,
	convertMinorUnits,
	CurrencyContext,
	currencyExponent,
	displayCurrency,
	displayLocale,
	formatMoney,
	fxTable,
	hydrateFromDom,
	projectMoney,
	resolveRate,
	setAmbientCurrencyResolver,
	setDisplayCurrency,
	setDisplayLocale,
	setRateTable,
	useCurrencyView,
} from "./core/currency-store.ts";
export type {
	CurrencyBootstrap,
	CurrencyRateTable,
	CurrencyView,
	MoneyOriginValue,
	MoneyValue,
	ProjectedMoney,
} from "./core/currency-store.ts";
export { PaymentCard, paymentCardArt, PaymentCardOption } from "./components/PaymentCard.tsx";
export type {
	PaymentCardArt,
	PaymentCardData,
	PaymentCardOptionProps,
	PaymentCardProps,
	PaymentCardSize,
} from "./components/PaymentCard.tsx";
export { List } from "./components/List.tsx";
export type { ListOrder, ListProps } from "./components/List.tsx";
export { ListItem } from "./components/ListItem.tsx";
export type { ListItemProps } from "./components/ListItem.tsx";
export { Accordion, AccordionTab } from "./islands/Accordion.tsx";
export type { AccordionProps, AccordionTabModel, AccordionTabProps } from "./islands/Accordion.tsx";
// #endregion
