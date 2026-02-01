import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  output: 'export', // Static export for GitHub Pages
  distDir: 'out', // Output directory for static export
  basePath: '/js-midi-sequencer', // Repository name for GitHub Pages
  assetPrefix: '/js-midi-sequencer/', // Ensure correct asset paths
  reactStrictMode: true,
  allowedDevOrigins: ['192.168.1.226', 'localhost', '*.local'],
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
