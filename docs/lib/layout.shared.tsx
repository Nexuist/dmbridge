import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { NavTitle } from "@/components/provider";
import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: NavTitle,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
