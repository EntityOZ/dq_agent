import type { NextConfig } from "next";

// Cloudflare Pages deployment — static export for wrangler pages deploy
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
