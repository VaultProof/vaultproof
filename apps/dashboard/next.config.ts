import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/vaultproof/dashboard",
  images: { unoptimized: true },
};

export default nextConfig;
