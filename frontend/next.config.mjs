// On Vercel the frontend and the FastAPI backend are services of one project on one domain:
// vercel.json routes /api/* to the backend, so the browser calls /api/... on the same origin.
// Locally (npm run dev) nothing changes: NEXT_PUBLIC_API_URL, or the default http://localhost:8000.
// Under `vercel dev` all services run together behind the same routing, so same-origin works there too.
const sameOrigin = Boolean(process.env.VERCEL) && process.env.NEXT_PUBLIC_API_URL === undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: sameOrigin ? { NEXT_PUBLIC_API_URL: "" } : {},
};

export default nextConfig;
