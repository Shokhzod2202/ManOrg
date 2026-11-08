import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@manorg/ui', '@manorg/contracts'],
};

export default nextConfig;
