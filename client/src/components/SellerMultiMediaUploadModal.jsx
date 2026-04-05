import { useMemo, useState } from 'react';

const ASPECT_OPTIONS = [
  { key: 'original', label: 'Original', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:5', label: '4:5', value: 4 / 5 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SellerMultiMediaUploadModal({ isOpen, onClose, onPost }) {
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [globalAspectKey, setGlobalAspectKey] = useState('4:5');
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const currentItem = items[currentIndex];
  const currentAspectOption = useMemo(
    () => ASPECT_OPTIONS.find((opt) => opt.key === globalAspectKey) ?? ASPECT_OPTIONS[2],
    [globalAspectKey],
  );

  const previewAspectClass = useMemo(() => {
    if (globalAspectKey === '1:1') return 'aspect-square';
    if (globalAspectKey === '16:9') return 'aspect-video';
    if (globalAspectKey === '4:5') return 'aspect-[4/5]';
    return 'aspect-[4/5]';
  }, [globalAspectKey]);

  if (!isOpen) return null;

  const updateItemAtIndex = (index, patch) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSelectFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const nextItems = files.map((file) => {
      const type = file.type.startsWith('video') ? 'video' : 'image';
      return {
        id: makeId(),
        file,
        url: URL.createObjectURL(file),
        type,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        naturalAspect: null,
      };
    });

    setItems(nextItems);
    setCurrentIndex(0);
    setGalleryOpen(true);
  };

  const handleAspectChange = (nextAspectKey) => {
    setGlobalAspectKey(nextAspectKey);
    setItems((prev) =>
      prev.map((item) =>
        item.type === 'image'
          ? {
              ...item,
              zoom: 1,
              offsetX: 0,
              offsetY: 0,
            }
          : item,
      ),
    );
  };

  const handlePost = async () => {
    if (!items.length || submitting) return;

    setSubmitting(true);
    try {
      const processed = items.map((item) => ({ type: item.type, url: item.url, file: item.file }));

      onPost(processed);
      onClose();
      setItems([]);
      setCurrentIndex(0);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-3 sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            onClick={onClose}
          >
            Back
          </button>
          <h2 className="text-sm font-semibold tracking-wide text-zinc-300">Create new post</h2>
          <button
            type="button"
            disabled={!items.length || submitting}
            className="rounded-md bg-sky-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handlePost}
          >
            {submitting ? 'Posting...' : 'Next'}
          </button>
        </header>

        <div className="grid flex-1 gap-4 overflow-hidden p-4 sm:grid-cols-[1fr_280px] sm:p-6">
          <section className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            {!items.length ? (
              <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center">
                <label className="cursor-pointer rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-3 text-sm font-medium hover:bg-zinc-700">
                  Select photos and videos
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={handleSelectFiles}
                  />
                </label>
              </div>
            ) : currentItem?.type === 'image' ? (
              <>
                <div className="flex h-full min-h-[360px] items-center justify-center p-4">
                  <div
                    className={`relative w-full max-w-[420px] overflow-hidden rounded-lg bg-zinc-900 ${previewAspectClass}`}
                    onMouseMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relX = (event.clientX - rect.left) / rect.width;
                      const relY = (event.clientY - rect.top) / rect.height;
                      const nextOffsetX = (relX - 0.5) * 60;
                      const nextOffsetY = (relY - 0.5) * 60;
                      updateItemAtIndex(currentIndex, {
                        offsetX: clamp(nextOffsetX, -30, 30),
                        offsetY: clamp(nextOffsetY, -30, 30),
                      });
                    }}
                    onWheel={(event) => {
                      event.preventDefault();
                      const delta = event.deltaY > 0 ? -0.06 : 0.06;
                      updateItemAtIndex(currentIndex, {
                        zoom: clamp(currentItem.zoom + delta, 1, 3),
                      });
                    }}
                  >
                    <img
                      src={currentItem.url}
                      alt="preview"
                      className="h-full w-full object-cover transition-transform duration-150"
                      onLoad={(event) => {
                        const ratio = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
                        updateItemAtIndex(currentIndex, { naturalAspect: ratio });
                      }}
                      style={{
                        transform: `translate(${currentItem.offsetX}px, ${currentItem.offsetY}px) scale(${currentItem.zoom})`,
                      }}
                    />
                  </div>
                </div>
                <div className="absolute bottom-2 left-2 right-2 rounded-md border border-zinc-700 bg-zinc-900/95 p-2 backdrop-blur">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <select
                      className="rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs"
                      value={globalAspectKey}
                      onChange={(event) => handleAspectChange(event.target.value)}
                    >
                      {ASPECT_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded-md border border-zinc-600 px-2 py-1 text-xs text-zinc-300"
                      onClick={() => setGalleryOpen((prev) => !prev)}
                    >
                      Gallery
                    </button>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>Zoom (hover image to frame)</span>
                      <span>{currentItem.zoom.toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.01"
                      value={currentItem.zoom}
                      onChange={(event) =>
                        updateItemAtIndex(currentIndex, { zoom: Number(event.target.value) })
                      }
                      className="w-full accent-sky-500"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="relative h-full min-h-[360px] bg-zinc-950">
                <video
                  src={currentItem?.url}
                  controls
                  className="h-full w-full object-contain"
                />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-xs text-zinc-300">
                  <span>Video selected</span>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-600 px-2 py-1"
                    onClick={() => setGalleryOpen((prev) => !prev)}
                  >
                    Gallery
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="flex min-h-[200px] flex-col rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Selection</p>
            {items.length ? (
              <div className="mb-3 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-300">
                Global ratio: {currentAspectOption.label} (applies to all images)
              </div>
            ) : null}
            {!items.length ? (
              <label className="inline-flex cursor-pointer rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium hover:bg-zinc-700">
                Browse media
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={handleSelectFiles}
                />
              </label>
            ) : galleryOpen ? (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border ${
                      currentIndex === index
                        ? 'border-sky-500 ring-1 ring-sky-500'
                        : 'border-zinc-700'
                    }`}
                  >
                    {item.type === 'image' ? (
                      <img src={item.url} alt="thumb" className="h-full w-full object-cover" />
                    ) : (
                      <video src={item.url} className="h-full w-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Gallery hidden. Click Gallery in preview to open.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
