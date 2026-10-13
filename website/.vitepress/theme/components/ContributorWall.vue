<script setup lang="ts">
import { data as contributors } from "../../contributors.data";

function contributionLabel(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}
</script>

<template>
  <ul class="contributor-wall" role="list">
    <li v-for="contributor in contributors" :key="contributor.login">
      <a
        class="contributor-wall__person"
        :href="contributor.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          class="contributor-wall__avatar"
          :src="`${contributor.avatarUrl}&s=96`"
          :alt="`${contributor.login} on GitHub`"
          width="48"
          height="48"
          loading="lazy"
          decoding="async"
        />
        <span class="contributor-wall__login">{{ contributor.login }}</span>
        <span class="contributor-wall__detail">
          {{ contributionLabel(contributor.contributions) }}
        </span>
      </a>
    </li>
  </ul>
</template>
