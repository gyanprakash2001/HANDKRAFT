import { useEffect, useMemo, useState, useRef } from 'react';

import FeedSkeleton from '../components/FeedSkeleton';
import ProductCard from '../components/ProductCard';
import { getProducts } from '../lib/api';

const CATEGORY_OPTIONS = [
  'Jewelry',
  'Home Decor',
  'Kitchen',
  'Textiles',
  'Pottery',
  'Woodwork',
  'Accessories',
  'Art',
  'Others',
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
];

export default function FeedPage() {
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
    limit: 12,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const hasFilters = Boolean(search || category || sort !== 'newest');

  const requestParams = useMemo(
    () => ({
      page,
      limit: 12,
      search,
      category,
      sort,
    }),
    [page, search, category, sort],
  );

  const observerRef = useRef();

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError('');

      try {
        const result = await getProducts({ ...requestParams, signal: controller.signal });
        const nextItems = Array.isArray(result?.items) ? result.items : [];
        const nextPagination = result?.pagination || {};

        setItems((prev) => (page === 1 ? nextItems : [...prev, ...nextItems]));
        setPagination({
          page: Number(nextPagination.page) || 1,
          totalPages: Number(nextPagination.totalPages) || 1,
          total: Number(nextPagination.total) || nextItems.length,
          limit: Number(nextPagination.limit) || 12,
        });
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(requestError.message || 'Could not load products right now.');
        if (page === 1) {
          setItems([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }

    loadProducts();

    return () => controller.abort();
  }, [requestParams]);

  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
  const hasMore = page < totalPages;

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;

    const sentinel = observerRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect();
          setPage((prev) => Math.min(prev + 1, totalPages));
        }
      },
      { rootMargin: '320px 0px', threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadingMore, hasMore, totalPages]);

  function handleSearchSubmit(event) {
    event.preventDefault();
    setSearch(draftSearch.trim());
    setPage(1);
  }

  function clearFilters() {
    setDraftSearch('');
    setSearch('');
    setCategory('');
    setSort('newest');
    setPage(1);
  }



  return (
    <section className="feed-page">
      <header className="feed-hero">
        <p className="hero-kicker">Curated by independent makers</p>
        <h1 className="hero-title">Find handmade pieces with story-first craftsmanship.</h1>
        <p className="hero-description">
          Browse fresh drops from artisans, compare styles, and open each listing for full details before checkout on mobile.
        </p>
      </header>

      <div className="filter-panel">
        <form className="search-form" onSubmit={handleSearchSubmit}>
          <label htmlFor="search-input" className="visually-hidden">
            Search handmade products
          </label>
          <input
            id="search-input"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Search by title, artisan, or material"
            className="search-input"
          />
          <button type="submit" className="search-btn">
            Search
          </button>
        </form>

        <div className="toolbar-row">
          <label className="select-wrap">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="select-wrap">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="toolbar-meta">
            <strong>{pagination.total}</strong>
            <span>items</span>
          </div>

          {hasFilters ? (
            <button type="button" className="ghost-btn" onClick={clearFilters}>
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setPage(1);
              setSearch((prev) => prev);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? <FeedSkeleton /> : null}

      {!loading && !error ? (
        <>
          <div className="product-grid">
            {items.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>

          {!items.length ? (
            <div className="empty-state">
              <h2>No listings matched this filter set</h2>
              <p>Try a wider search term or reset filters to explore all artisan products.</p>
            </div>
          ) : null}

          {hasMore ? (
            <div ref={observerRef} className="loading-sentinel">
              {loadingMore ? (
                <div className="spinner-wrap">
                  <div className="loading-spinner"></div>
                  <span>Loading more items...</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={() => setPage((current) => current + 1)}
                >
                  Load More
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
