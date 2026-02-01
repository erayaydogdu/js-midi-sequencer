import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // output: 'export', // Uncomment for static export
  // basePath: '/js-midi-sequencer', // Add this line with your repository name
  // assetPrefix: '/js-midi-sequencer/', // Add this line to ensure correct asset paths
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
