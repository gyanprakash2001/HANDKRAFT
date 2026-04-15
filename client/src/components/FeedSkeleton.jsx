export default function FeedSkeleton() {
  return (
    <div className="product-grid" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <article key={index} className="skeleton-card">
          <div className="skeleton-media shimmer" />
          <div className="skeleton-content">
            <div className="skeleton-line shimmer short" />
            <div className="skeleton-line shimmer" />
            <div className="skeleton-line shimmer medium" />
          </div>
        </article>
      ))}
    </div>
  );
}
