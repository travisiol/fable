import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project is its own root (a stray lockfile higher up would otherwise be picked).
  turbopack: { root: process.cwd() },
  // PGlite ships its Postgres as WASM + data files that must stay next to the package.
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ["127.0.0.1"],
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
