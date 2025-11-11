import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Optimize for production
  reactStrictMode: true,

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
