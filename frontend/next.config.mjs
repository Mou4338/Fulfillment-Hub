// BACKEND_URL — where the FastAPI backend is deployed, e.g. https://fulfillment-hub-api.vercel.app
// When set, the browser calls /api/... on this site and Next.js forwards it to the backend,
// so there is no CORS setup and no cross-site URL baked into the client.
// Local development is unchanged: leave BACKEND_URL empty and use NEXT_PUBLIC_API_URL (or the default).
const backendUrl = (process.env.BACKEND_URL || "").trim().replace(/\/+$/, "");
const explicitApiUrl = process.env.NEXT_PUBLIC_API_URL;

if (backendUrl && !/^https?:\/\//.test(backendUrl)) {
  throw new Error(`BACKEND_URL must start with http:// or https:// (got "${backendUrl}").`);
}
if (process.env.VERCEL && !backendUrl && !explicitApiUrl) {
  throw new Error(
    "Set the BACKEND_URL environment variable in this Vercel project to your backend's URL " +
      "(for example https://fulfillment-hub-api.vercel.app), then redeploy."
  );
}

const useProxy = Boolean(backendUrl) && explicitApiUrl === undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: useProxy ? { NEXT_PUBLIC_API_URL: "", NEXT_PUBLIC_BACKEND_URL: backendUrl } : {},
  async rewrites() {
    return useProxy ? [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }] : [];
  },
};

export default nextConfig;
