/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  devIndicators: false,
  outputFileTracingExcludes: {
    '*': ['./zynk/**/*'],
  },
};

export default nextConfig;
