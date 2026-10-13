import type { Theme } from "vitepress";
import CopyOrDownloadAsMarkdownButtons from "vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue";
import DefaultTheme from "vitepress/theme";

import Layout from "./Layout.vue";
import ContributorWall from "./components/ContributorWall.vue";
import PathCard from "./components/PathCard.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("ContributorWall", ContributorWall);
    app.component("CopyOrDownloadAsMarkdownButtons", CopyOrDownloadAsMarkdownButtons);
    app.component("PathCard", PathCard);
  },
} satisfies Theme;
