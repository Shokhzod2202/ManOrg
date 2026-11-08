import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@manorg/ui', '@manorg/contracts'],
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
};

export default nextConfig;
