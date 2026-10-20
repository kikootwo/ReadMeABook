import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',

  // Routes that open admin-configured paths (download/media dirs) make the tracer include the
  // whole project root ("Dynamic filesystem access" build warnings). Keep everything that is not
  // runtime out of .next/standalone; dockerfile.unified copies prisma/, public/, scripts/ and the
  // generated client explicitly. See documentation/deployment/unified.md ("Not shipped").
  outputFileTracingExcludes: {
    '*': [
      './src/app/**', './src/components/**', './src/contexts/**', './src/hooks/**', './src/lib/**', './src/*.ts',
      './tests/**', './e2e/**', './screenshots/**', './documentation/**', './docker/**', './.github/**',
      './*.md', './LICENSE', './unraid.xml', './dockerfile.unified', './docker-compose*.yml', './docker-entrypoint.sh',
      './tsconfig.json', './vitest.config.ts', './eslint.config.mjs', './postcss.config.mjs', './next.config.ts',
      './package-lock.json', './rmab_icon.ico', './*.tsbuildinfo',
    ],
  },

  // Optimize for production
  reactStrictMode: true,

  // Externalize packages that should only run on the server
  // Bull uses child processes and is incompatible with client bundling
  serverExternalPackages: ['bull'],

  // Turbopack configuration (silence migration warning)
  turbopack: {},

  // Webpack configuration for when not using Turbopack
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle Bull on the client side - it's server-only
      config.resolve.alias = {
        ...config.resolve.alias,
        'bull': false,
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
