/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  assetPrefix: process.env.NODE_ENV === 'production' 
    ? undefined 
    : `http://${process.env.TAURI_DEV_HOST || 'localhost'}:3000`,
  outputFileTracingExcludes: {
    '*': ['./zynk/**/*'],
  },
};

export default nextConfig;
