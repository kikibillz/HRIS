import type { NextConfig } from "next";
import { previewHostname } from "./lib/preview";
const host = previewHostname();
const config: NextConfig = { allowedDevOrigins: host ? [host] : [] };
export default config;
