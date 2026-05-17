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
    .map((entry): NormalizedProductMediaItem => {
      const type = entry?.type === 'video' ? 'video' : 'image';
      const url = normalizeAssetUrl(entry?.url);
      const thumbnailUrl = normalizeAssetUrl(entry?.thumbnailUrl || (type === 'image' ? entry?.url : ''));
      const rawThumbnailDataUri = typeof entry?.thumbnailDataUri === 'string' ? entry.thumbnailDataUri.trim() : '';

      return {
        type,
        url,
        thumbnailUrl: thumbnailUrl || undefined,
        thumbnailDataUri: rawThumbnailDataUri.startsWith('data:image/') ? rawThumbnailDataUri : undefined,
        aspectRatio: Number.isFinite(Number(entry?.aspectRatio)) ? Number(entry?.aspectRatio) : undefined,
      };
    })
    .filter((entry) => Boolean(entry.url));

  if (normalized.length > 0) {
    return normalized;
  }

  const images = Array.isArray(item.images) ? item.images : [];
  return images
    .map((url) => ({
      type: 'image' as const,
      url: normalizeAssetUrl(url),
      thumbnailUrl: normalizeAssetUrl(url),
      aspectRatio: Number.isFinite(Number(item.imageAspectRatio)) ? Number(item.imageAspectRatio) : undefined,
    }))
    .filter((entry) => Boolean(entry.url));
}

export function resolveProductImageUri(item: ProductItem): string {
  const media = Array.isArray(item.media) ? item.media : [];
  const imageEntry = media.find(
    (entry) => entry?.type === 'image' && (entry.thumbnailDataUri || entry.thumbnailUrl || entry.url)
  );
  const candidate = imageEntry?.thumbnailUrl
    || imageEntry?.url
    || item.images?.[0]
    || imageEntry?.thumbnailDataUri;

  return normalizeAssetUrl(candidate) || '';
}

export function normalizeProduct(item: ProductItem): NormalizedProduct {
  const rawImages = Array.isArray(item.images) ? item.images : [];
  const images = rawImages.map((url) => normalizeAssetUrl(url)).filter(Boolean);
  const media = normalizeProductMedia(item);
  const price = Math.max(0, toFiniteNumber(item.price, 0));
  const realPrice = Math.max(0, toFiniteNumber(item.realPrice ?? item.price, price));
  const discountedPrice = Number.isFinite(Number(item.discountedPrice)) ? Math.max(0, Number(item.discountedPrice)) : undefined;
  const stock = Math.max(0, toFiniteNumber(item.stock, 0));
  const category = String(item.category || 'Uncategorized').trim() || 'Uncategorized';
  const mediaImages = media.filter((entry) => entry.type === 'image').map((entry) => entry.url).filter(Boolean);
  const normalizedImages = images.length > 0
    ? images
    : (mediaImages.length > 0 ? mediaImages : ['https://placehold.co/600x400?text=Handmade']);

  return {
    ...item,
    title: String(item.title || '').trim() || 'Untitled item',
    description: String(item.description || '').trim(),
    category,
    price,
    realPrice,
    discountedPrice,
    stock,
    images: normalizedImages,
    media,
    imageAspectRatio: Number.isFinite(Number(item.imageAspectRatio)) ? Number(item.imageAspectRatio) : undefined,
  };
}

export function getProductFallbackImage(item: ProductItem) {
  const normalized = normalizeProduct(item);
  return normalized.images[0] || 'https://placehold.co/600x400?text=Handmade';
}
