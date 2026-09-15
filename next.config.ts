import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Optimize for production
  reactStrictMode: true,

  // Externalize packages that should only run on the server
  // Bull uses child processes and is incompatible with client bundling
  // discord.js is the gateway bot client — server-only, never bundled for the client
  serverExternalPackages: ['bull', 'discord.js'],

  // Turbopack configuration (silence migration warning)
  turbopack: {},

  // Webpack configuration for when not using Turbopack
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle Bull or discord.js on the client side - they're server-only
      config.resolve.alias = {
        ...config.resolve.alias,
        'bull': false,
        'discord.js': false,
      };
    }
    return config;
  },

  // Image optimization - DISABLED because we handle our own thumbnail caching
  // in /app/cache/thumbnails/ via the Audible refresh job
  images: {
    unoptimized: true, // Disable Next.js image optimization
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
