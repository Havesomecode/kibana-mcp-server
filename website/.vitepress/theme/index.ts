import type { Theme } from "vitepress";
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
    app.component("PathCard", PathCard);
  },
} satisfies Theme;
