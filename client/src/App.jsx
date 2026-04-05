import { useState } from 'react';

import SellerMultiMediaUploadModal from './components/SellerMultiMediaUploadModal';

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [posts, setPosts] = useState([]);

  const handlePost = (media) => {
    setPosts((prev) => [
      {
        id: `${Date.now()}`,
        caption: 'Fresh handmade upload',
        media,
      },
      ...prev,
    ]);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div>
            <h1 className="text-xl font-semibold">HANDKRAFT Seller Studio</h1>
            <p className="text-sm text-zinc-400">Upload multiple images/videos, crop images, then publish to feed slider.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-zinc-950"
          >
            Create Post
          </button>
        </div>

        <div className="space-y-4">
          {posts.map((post) => (
            <article key={post.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              <header className="border-b border-zinc-800 px-4 py-3 text-sm text-zinc-300">{post.caption}</header>
              <div className="flex snap-x snap-mandatory gap-0 overflow-x-auto">
                {post.media.map((mediaItem, index) => (
                  <div key={`${post.id}-${index}`} className="h-[420px] w-full shrink-0 snap-start bg-zinc-950">
                    {mediaItem.type === 'image' ? (
                      <img src={mediaItem.url} alt={`post-${index}`} className="h-full w-full object-cover" />
                    ) : (
                      <video src={mediaItem.url} controls className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}

          {!posts.length ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/70 px-4 py-8 text-center text-zinc-500">
              No posts yet. Click Create Post to test the seller upload flow.
            </div>
          ) : null}
        </div>
      </section>

      <SellerMultiMediaUploadModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPost={handlePost}
      />
    </main>
  );
}

export default App;
