import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://ithome-ironman-observer.happyhacking.ninja",
  output: "static",
  integrations: [sitemap()],
});
