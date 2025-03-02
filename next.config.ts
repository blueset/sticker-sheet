import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config) => {
    config.module.rules.push({
      test: /\.ya?ml$/,
      use: "yaml-loader",
    });
    return config;
  },
  experimental: {
    turbo: {
      // resolveExtensions: [".yaml"],
      rules: {
        "*.yaml": {
          loaders: ["yaml-loader"],
          as: "*.js",
        },
      },
    },
  },
  output: "export",
};

export default nextConfig;
