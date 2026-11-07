/// <reference lib="dom" />
import type { Deck, SlideScene } from "./pptx-model.ts";
import type { SceneImage } from "./pptx-paint.ts";

/**
 * pptx-images — the pictures a slide draws, decoded once and shared between slides, because a deck's
 * logo sits on all of them. A bound keeps a photo-heavy deck from holding every bitmap at once.
 */

/** A deck's decoded pictures. */
export interface SceneImages {
	/** Decode what a scene needs. A picture that fails to decode is simply absent. */
	load(scene: SlideScene): Promise<Map<string, SceneImage>>;
	/** Free every bitmap. */
	dispose(): void;
}

const MAX_BITMAPS = 48;

/** Create the cache. `maxWidth` decodes down, which is what keeps a card's thumbnail cheap. */
export function createSceneImages(deck: Deck, maxWidth?: number): SceneImages {
	const cache = new Map<string, Promise<ImageBitmap | null>>();

	const decode = async (path: string): Promise<ImageBitmap | null> => {
		const blob = await deck.media(path).catch(() => null);
		if (!blob) return null;
		const options = maxWidth ? { resizeWidth: maxWidth } : undefined;
		return await createImageBitmap(blob, options).catch(() => null);
	};

	const evict = (keep: ReadonlySet<string>): void => {
		for (const path of cache.keys()) {
			if (cache.size <= MAX_BITMAPS) return;
			if (keep.has(path)) continue;
			cache.get(path)?.then((bitmap) => bitmap?.close());
			cache.delete(path);
		}
	};

	return {
		async load(scene) {
			const wanted = new Set(scene.media);
			const loaded = new Map<string, SceneImage>();
			await Promise.all(scene.media.map(async (path) => {
				let pending = cache.get(path);
				if (!pending) {
					pending = decode(path);
					cache.set(path, pending);
				}
				const bitmap = await pending;
				if (bitmap) loaded.set(path, bitmap);
			}));
			evict(wanted);
			return loaded;
		},
		dispose() {
			for (const pending of cache.values()) pending.then((bitmap) => bitmap?.close());
			cache.clear();
		},
	};
}
