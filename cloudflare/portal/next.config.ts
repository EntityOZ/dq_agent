import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    runtime: "edge",
  },
};

export default nextConfig;
