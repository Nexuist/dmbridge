import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="tc-wordmark" aria-label="twocents dmbridge">
          <span className="tc-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 30" fill="none">
              <path
                d="M5 2.5h29A3.5 3.5 0 0 1 37.5 6v15a3.5 3.5 0 0 1-3.5 3.5H17l-8 4.5 1.5-4.5H5A3.5 3.5 0 0 1 1.5 21V6A3.5 3.5 0 0 1 5 2.5Z"
                fill="currentColor"
              />
              <circle cx="14" cy="13.5" r="7" fill="#121217" />
              <circle cx="25.5" cy="13.5" r="7" stroke="#121217" strokeWidth="1.75" />
              <text x="11" y="16.7" fill="currentColor" fontSize="9" fontWeight="800">
                2
              </text>
              <text x="22.3" y="16.6" fill="#121217" fontSize="9" fontWeight="800">
                ¢
              </text>
            </svg>
          </span>
          <span className="tc-wordmark-company">twocents</span>
          <span className="tc-wordmark-divider">/</span>
          <span className="tc-wordmark-product">dmbridge</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
