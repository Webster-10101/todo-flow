/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export — the Capacitor iOS shell packages the out/ directory.
  // The app is fully client-side (no API routes), so this is lossless.
  // Vercel auto-detects export output; the web deploy is unchanged.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;


