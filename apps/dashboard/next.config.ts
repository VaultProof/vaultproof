import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/zkvault/dashboard",
  images: { unoptimized: true },
};

export default nextConfig;
