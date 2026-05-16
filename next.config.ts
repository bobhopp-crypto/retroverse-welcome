import type { NextConfig } from "next";

const mzHost = (n: string) => ({
  protocol: "https" as const,
  hostname: `is${n}-ssl.mzstatic.com`,
  pathname: "/**" as const,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [mzHost("1"), mzHost("2"), mzHost("3"), mzHost("4"), mzHost("5")],
  },
  async redirects() {
    return [
      { source: "/", destination: "/album-retroscope", permanent: true },
      { source: "/index", destination: "/site-index", permanent: false },
    ];
  },
  /**
   * Without these excludes Next's NFT (Node File Tracing) follows the
   * `path.join(process.cwd(), ...)` and `fs.readFileSync(...)` calls in
   * dev-only ops routes and pulls 80,000+ files into each serverless function
   * bundle — easily breaching Vercel's 50MB unzipped limit and adding cold-
   * start latency. The directories below are local-only data / artifacts and
   * must not ship.
   */
  outputFileTracingExcludes: {
    "*": [
      "**/data/raw/**",
      "**/data/exports/**",
      "**/data/staged/**",
      "**/data/imports/**",
      "**/data/snapshots/**",
      "**/data/audits/**",
      "**/RETROVERSE_DATA/**",
      "**/.next/cache/**",
      "**/scripts/**",
      "**/node_modules/.cache/**",
    ],
  },
};

export default nextConfig;
