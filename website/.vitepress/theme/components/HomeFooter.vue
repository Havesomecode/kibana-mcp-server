<script setup lang="ts">
import { withBase } from "vitepress";

// A fixed pattern of log lines: widths in percent, a few of them carrying the signal colour.
const lines = [
  [38, false],
  [62, false],
  [24, true],
  [71, false],
  [46, false],
  [30, false],
  [58, true],
  [20, false],
  [66, false],
  [42, false],
  [28, false],
  [54, true],
] as const;
</script>

<template>
  <footer class="home-footer">
    <div class="home-footer__lines" aria-hidden="true">
      <span
        v-for="([width, signal], index) in [...lines, ...lines]"
        :key="index"
        class="home-footer__line"
        :class="{ 'is-signal': signal }"
        :style="{ width: `${width}%` }"
      />
    </div>
    <div class="home-footer__content">
      <p class="home-footer__title">Give your agents a way into the logs</p>
      <div class="home-footer__actions">
        <a class="home-footer__button" :href="withBase('/guide/getting-started')">Get started</a>
        <a
          class="home-footer__link"
          href="https://github.com/Havesomecode/kibana-mcp-server"
          target="_blank"
          rel="noopener noreferrer"
        >
          View the source
        </a>
      </div>
      <p class="home-footer__legal">
        Released under the MIT License. Independent project, not affiliated with or endorsed by
        Elastic. Kibana and Elasticsearch are trademarks of Elasticsearch B.V.
      </p>
      <p class="home-footer__legal">Copyright © Havesomecode</p>
    </div>
  </footer>
</template>
