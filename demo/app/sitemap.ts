import type { MetadataRoute } from "next";

const SITE_URL = "https://x402-stacks.fixr.nexus";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
