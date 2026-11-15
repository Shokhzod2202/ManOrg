import type { NextConfig } from 'next';

/** Where the web server forwards /api/v1 calls; the browser always calls its own origin. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@manorg/ui', '@manorg/contracts'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` }];
  },
};

export default nextConfig;
