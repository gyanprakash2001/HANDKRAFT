import { Link } from 'react-router-dom';

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

function getPrimaryImage(product) {
  const mediaImage = Array.isArray(product?.media)
    ? product.media.find((entry) => entry?.type === 'image' && (entry.thumbnailUrl || entry.url))
    : null;

  if (mediaImage?.thumbnailUrl || mediaImage?.url) {
    return mediaImage.thumbnailUrl || mediaImage.url;
  }

  if (Array.isArray(product?.images) && product.images.length > 0) {
    return product.images[0];
  }

  return 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900';
}

function getDisplayPrice(product) {
  const discounted = Number(product?.discountedPrice);
  if (Number.isFinite(discounted) && discounted > 0) {
    return discounted;
  }

  const realPrice = Number(product?.realPrice);
  if (Number.isFinite(realPrice) && realPrice > 0) {
    return realPrice;
  }

  return Number(product?.price) || 0;
}

export default function ProductCard({ product }) {
  const image = getPrimaryImage(product);
  const displayPrice = getDisplayPrice(product);
  const realPrice = Number(product?.realPrice || product?.price || 0);
  const hasDiscount = Number.isFinite(realPrice) && realPrice > displayPrice;

  return (
    <article className="product-card">
      <Link to={`/product/${product._id}`} className="product-link" aria-label={`Open ${product.title}`}>
        <figure className="product-media-wrap">
          <img src={image} alt={product.title} className="product-media" loading="lazy" />
          {product?.monthlySold > 0 ? (
            <span className="metric-pill">{product.monthlySold} sold this month</span>
          ) : null}
        </figure>

        <div className="product-content">
          <p className="product-category">{product.category || 'Handmade'}</p>
          <h3 className="product-title">{product.title}</h3>
          <p className="product-seller">By {product.sellerName || 'Handkraft Artisan'}</p>

          <div className="price-row">
            <strong className="price-main">{toCurrency(displayPrice)}</strong>
            {hasDiscount ? <span className="price-cut">{toCurrency(realPrice)}</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
