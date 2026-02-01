/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Electron
  output: 'export',
  
  // Images must be unoptimized for static export
  images: {
    unoptimized: true,
  },
  
  // Disable dev indicators in production
  devIndicators: false,
  
  // Exclude large directories from tracing
  outputFileTracingExcludes: {
    '*': ['./zynk/**/*'],
  },
};

export default nextConfig;
