import { createGetUrl } from "fumadocs-core/source";

export const appName = "dmbridge";
export const docsRoute = "/docs";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const docsContentRoute = `${publicBasePath}/llms.mdx/docs`;

export const gitConfig = {
  user: "Nexuist",
  repo: "dmbridge",
  branch: "main",
};

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];
  return { segments, url: getContentUrl(segments, page.locale) };
}
