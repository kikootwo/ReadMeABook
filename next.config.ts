import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Optimize for production
  reactStrictMode: true,

  // Externalize packages that should only run on the server
  // Bull uses child processes and is incompatible with the Edge Runtime
  serverComponentsExternalPackages: ['bull'],

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'm.media-amazon.com', // Audible cover images
      },
      {
        protocol: 'https',
        hostname: 'images-na.ssl-images-amazon.com', // Audible cover images
      },
    ],
  },
};

export default nextConfig;
