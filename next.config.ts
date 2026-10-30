import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "postgres"],
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/**", "./public/fonts/**", "./tests/fixtures/**"],
  },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
