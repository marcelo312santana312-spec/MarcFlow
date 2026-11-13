import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Limpar páginas inativas da memória RAM agressivamente no celular/Termux
  onDemandEntries: {
    maxInactiveAge: 15 * 1000,
    pagesBufferLength: 2,
  },
  // Loaded from node_modules at runtime instead of bundled: audio-decode (voice note waveform for Baileys)
  // pulls in a web-worker shim with a dynamic import that Turbopack can't resolve.
  serverExternalPackages: ["sharp", "bcryptjs", "@whiskeysockets/baileys", "audio-decode"],
  // Media and voice notes go through server actions; default limit is 1 MB
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
