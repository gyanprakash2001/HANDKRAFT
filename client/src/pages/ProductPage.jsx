import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import ProductCard from '../components/ProductCard';
import { getProductById, getProducts } from '../lib/api';

function toCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '\u20b90';
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildMediaItems(product) {
  if (Array.isArray(product?.media) && product.media.length > 0) {
    return product.media.map((entry) => ({
      type: entry?.type === 'video' ? 'video' : 'image',
      url: entry?.url || entry?.thumbnailUrl,
      thumbnailUrl: entry?.thumbnailUrl || entry?.url,
    }));
  }

  if (Array.isArray(product?.images) && product.images.length > 0) {
    return product.images.map((url) => ({
      type: 'image',
      url,
      thumbnailUrl: url,
    }));
  }

  return [
    {
      type: 'image',
      url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900',
      thumbnailUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=450',
    },
  ];
}

export default function ProductPage() {
  const { productId } = useParams();

  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadProduct() {
      setLoading(true);
      setError('');

      try {
        const nextProduct = await getProductById(productId, { signal: controller.signal });
        setProduct(nextProduct);

        if (nextProduct?.category) {
          const relatedResult = await getProducts({
            category: nextProduct.category,
            limit: 6,
            sort: 'newest',
            signal: controller.signal,
          });

          const relatedItems = (relatedResult?.items || []).filter((item) => item._id !== nextProduct._id).slice(0, 4);
          setRelated(relatedItems);
        } else {
          setRelated([]);
        }
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(requestError.message || 'Could not load this product.');
        setProduct(null);
        setRelated([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProduct();

    return () => controller.abort();
  }, [productId]);

  const mediaItems = useMemo(() => buildMediaItems(product), [product]);

  useEffect(() => {
    setSelectedMediaIndex(0);
  }, [productId]);

  const activeMedia = mediaItems[Math.min(selectedMediaIndex, mediaItems.length - 1)] || mediaItems[0];

  const displayPrice = Number(product?.discountedPrice || product?.realPrice || product?.price || 0);
  const basePrice = Number(product?.realPrice || product?.price || 0);
  const hasDiscount = Number.isFinite(basePrice) && basePrice > displayPrice;

  if (loading) {
    return (
      <section className="product-page">
        <p className="back-link">Loading product details...</p>
        <div className="product-shell loading-shell" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="product-page">
        <Link to="/" className="back-link">
          \u2190 Back to feed
        </Link>
        <div className="error-panel" role="alert">
          <p>{error}</p>
        </div>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="product-page">
        <Link to="/" className="back-link">
          \u2190 Back to feed
        </Link>
        <div className="empty-state">
          <h2>Product not found</h2>
        </div>
      </section>
    );
  }

  return (
    <section className="product-page">
      <Link to="/" className="back-link">
        \u2190 Back to feed
      </Link>

      <article className="product-shell">
        <div className="media-column">
          <div className="hero-media">
            {activeMedia?.type === 'video' ? (
              <video src={activeMedia.url} controls className="hero-media-content" />
            ) : (
              <img src={activeMedia?.url} alt={product.title} className="hero-media-content" />
            )}
          </div>

          {mediaItems.length > 1 ? (
            <div className="media-thumbs">
              {mediaItems.map((item, index) => (
                <button
                  type="button"
                  key={`${product._id}-media-${index}`}
                  className={`media-thumb ${index === selectedMediaIndex ? 'active' : ''}`}
                  onClick={() => setSelectedMediaIndex(index)}
                >
                  {item.type === 'video' ? (
                    <span className="video-chip">Video</span>
                  ) : (
                    <img src={item.thumbnailUrl || item.url} alt={`Thumbnail ${index + 1}`} />
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="details-column">
          <p className="product-category detail-category">{product.category || 'Handmade'}</p>
          <h1 className="detail-title">{product.title}</h1>
          <p className="product-seller detail-seller">Crafted by {product.sellerName || 'Handkraft Artisan'}</p>

          <div className="price-row detail-price-row">
            <strong className="price-main">{toCurrency(displayPrice)}</strong>
            {hasDiscount ? <span className="price-cut">{toCurrency(basePrice)}</span> : null}
          </div>

          <p className="detail-description">{product.description || 'No description provided yet.'}</p>

          <dl className="meta-grid">
            <div>
              <dt>Material</dt>
              <dd>{product.material || 'Not specified'}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>{Number(product.stock) > 0 ? `${product.stock} available` : 'Out of stock'}</dd>
            </div>
            <div>
              <dt>Rating</dt>
              <dd>{Number(product.ratingAverage || 0).toFixed(1)} ({product.reviewCount || 0} reviews)</dd>
            </div>
          </dl>
        </div>
      </article>

      {related.length > 0 ? (
        <section className="related-block">
          <h2>More in {product.category}</h2>
          <div className="product-grid related-grid">
            {related.map((item) => (
              <ProductCard key={item._id} product={item} />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
