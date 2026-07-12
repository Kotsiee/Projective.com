import { Container, Divider, Stack } from "@projective/ui/layout";

/**
 * PagePlaceholder — a server-rendered scaffold body for skeleton routes.
 *
 * Not an island (zero client JS). Composed from `@projective/ui/layout` primitives to dogfood them.
 * Replace per-route as features are built (see documentation/PRODUCT_MANAGEMENT.md).
 */
export interface PagePlaceholderProps {
	/** Human-readable page name. */
	title: string;
	/** The canonical URL pattern this route serves, e.g. `/projects/[projectId]`. */
	path: string;
	/** Optional one-line note about what will live here. */
	note?: string;
}

export function PagePlaceholder({ title, path, note }: PagePlaceholderProps) {
	return (
		<Container as="section" size="lg" class="page">
			<Stack gap={2}>
				<h1 class="page__title">{title}</h1>
				<p class="page__path">
					<code>{path}</code>
				</p>
				<Divider />
				<p class="page__note">{note ?? "Route scaffold — page logic pending."}</p>
			</Stack>
		</Container>
	);
}
