import type { NextConfig } from "next";
import { previewHostname } from "./lib/preview";
const host = previewHostname();
const config: NextConfig = {
  output: "standalone",
  allowedDevOrigins: host ? [host] : [],
};
export default config;
