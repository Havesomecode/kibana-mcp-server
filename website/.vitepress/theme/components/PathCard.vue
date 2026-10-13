<script setup lang="ts">
import { withBase } from "vitepress";

defineProps<{
  kicker: string;
  title: string;
  /** Hops of a request, rendered as one line: agent → server → Kibana. */
  route: string[];
  link: string;
  linkText: string;
  secondaryLink?: string;
  secondaryText?: string;
  highlight?: boolean;
}>();
</script>

<template>
  <article class="path-card home-tile" :class="{ 'path-card--highlight': highlight }">
    <p class="path-card__kicker">{{ kicker }}</p>
    <h3 class="path-card__title">{{ title }}</h3>
    <p class="path-card__route" aria-label="Request path">
      <template v-for="(hop, index) in route" :key="hop">
        <span v-if="index > 0" class="path-card__arrow" aria-hidden="true">→</span>
        <span class="path-card__hop">{{ hop }}</span>
      </template>
    </p>
    <div class="path-card__points">
      <slot />
    </div>
    <p class="path-card__actions">
      <a class="path-card__primary" :href="withBase(link)">{{ linkText }}</a>
      <a v-if="secondaryLink" class="path-card__secondary" :href="withBase(secondaryLink)">
        {{ secondaryText }}
      </a>
    </p>
  </article>
</template>
