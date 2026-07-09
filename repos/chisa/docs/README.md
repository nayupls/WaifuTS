# chisa-docs

Documentation site and landing page for [Chisa](../README.md), built with
[Fumadocs](https://fumadocs.dev) on Next.js.

```bash
npm install
npm run dev     # http://localhost:3000  (landing at /, docs at /docs)
npm run build   # production build
```

- Landing page: `app/(home)/page.tsx`
- Docs content: `content/docs/*.mdx` (ordering in `content/docs/meta.json`)
- Search API (Orama), OG images, `llms.txt` / per-page `content.md` routes are
  set up out of the box.
