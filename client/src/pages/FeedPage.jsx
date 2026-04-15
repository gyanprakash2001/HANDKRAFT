import { useEffect, useMemo, useState } from 'react';

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

  useEffect(() => {
    const controller = new AbortController();

    async function loadProducts() {
      setLoading(true);
      setError('');

      try {
        const result = await getProducts({ ...requestParams, signal: controller.signal });
        const nextItems = Array.isArray(result?.items) ? result.items : [];
        const nextPagination = result?.pagination || {};

        setItems(nextItems);
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
        setItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadProducts();

    return () => controller.abort();
  }, [requestParams]);

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

  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);

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

          {items.length > 0 ? (
            <nav className="pagination" aria-label="Products pagination">
              <button
                type="button"
                className="page-btn"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>

              <p>
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </p>

              <button
                type="button"
                className="page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
