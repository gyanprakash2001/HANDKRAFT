import { normalizeAssetUrl, ProductItem, ProductMediaItem } from '@/utils/api';

export type NormalizedProductMediaItem = ProductMediaItem & {
  url: string;
  type: 'image' | 'video';
  aspectRatio?: number;
};

export type NormalizedProduct = ProductItem & {
  images: string[];
  media?: NormalizedProductMediaItem[];
  category: string;
  title: string;
  description: string;
  price: number;
  realPrice?: number;
  discountedPrice?: number;
  imageAspectRatio?: number;
  stock: number;
};

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeProductMedia(item: ProductItem): NormalizedProductMediaItem[] {
  const media = Array.isArray(item.media) ? item.media : [];
  const normalized = media
    .map((entry) => ({
      type: entry?.type === 'video' ? 'video' : 'image',
      url: String(entry?.url || '').trim(),
      thumbnailUrl: String(entry?.thumbnailUrl || '').trim() || undefined,
      thumbnailDataUri: typeof entry?.thumbnailDataUri === 'string' && entry.thumbnailDataUri.trim().startsWith('data:')
        ? entry.thumbnailDataUri.trim()
        : undefined,
      aspectRatio: Number.isFinite(Number(entry?.aspectRatio)) ? Number(entry?.aspectRatio) : undefined,
    }))
    .filter((entry) => Boolean(entry.url));

  if (normalized.length > 0) {
    return normalized;
  }

  const images = Array.isArray(item.images) ? item.images : [];
  return images
    .map((url) => ({ type: 'image' as const, url: String(url || '').trim(), aspectRatio: Number.isFinite(Number(item.imageAspectRatio)) ? Number(item.imageAspectRatio) : undefined }))
    .filter((entry) => Boolean(entry.url));
}

export function resolveProductImageUri(item: ProductItem): string {
  const media = Array.isArray(item.media) ? item.media : [];
  const imageEntry = media.find(
    (entry) => entry?.type === 'image' && (entry.thumbnailDataUri || entry.thumbnailUrl || entry.url)
  );
  const candidate = imageEntry?.thumbnailDataUri
    || imageEntry?.thumbnailUrl
    || imageEntry?.url
    || item.images?.[0];

  return normalizeAssetUrl(candidate) || '';
}

export function normalizeProduct(item: ProductItem): NormalizedProduct {
  const rawImages = Array.isArray(item.images) ? item.images : [];
  const images = rawImages.map((url) => String(url || '').trim()).filter(Boolean);
  const media = normalizeProductMedia(item);
  const price = Math.max(0, toFiniteNumber(item.price, 0));
  const realPrice = Math.max(0, toFiniteNumber(item.realPrice ?? item.price, price));
  const discountedPrice = Number.isFinite(Number(item.discountedPrice)) ? Math.max(0, Number(item.discountedPrice)) : undefined;
  const stock = Math.max(0, toFiniteNumber(item.stock, 0));
  const category = String(item.category || 'Uncategorized').trim() || 'Uncategorized';

  return {
    ...item,
    title: String(item.title || '').trim() || 'Untitled item',
    description: String(item.description || '').trim(),
    category,
    price,
    realPrice,
    discountedPrice,
    stock,
    images: images.length > 0 ? images : ['https://placehold.co/600x400?text=Handmade'],
    media,
    imageAspectRatio: Number.isFinite(Number(item.imageAspectRatio)) ? Number(item.imageAspectRatio) : undefined,
  };
}

export function getProductFallbackImage(item: ProductItem) {
  const normalized = normalizeProduct(item);
  return normalized.images[0] || 'https://placehold.co/600x400?text=Handmade';
}
