/**
 * Route slugs — the prefixed, opaque, immutable identifier every public route addresses a row by.
 *
 * @module
 */
export {
	isSlug,
	mintSlug,
	SLUG_ALPHABET,
	SLUG_BODY_LENGTH,
	SLUG_PREFIXES,
	SLUGGED_ENTITIES,
	slugEntityOf,
	slugPattern,
	type SluggedEntity,
} from "./slug.ts";
