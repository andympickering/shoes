import nextEnv from "@next/env";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(
  projectRoot,
  process.env.NODE_ENV !== "production",
  console,
  true
);

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
