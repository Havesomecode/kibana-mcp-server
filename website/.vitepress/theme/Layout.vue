<script setup lang="ts">
import { useData, useRoute } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";

import HeroBadge from "./components/HeroBadge.vue";
import HeroStats from "./components/HeroStats.vue";
import HomeFooter from "./components/HomeFooter.vue";
import InvestigationPanel from "./components/InvestigationPanel.vue";

const { frontmatter } = useData();
const route = useRoute();

let observer: IntersectionObserver | undefined;

// Cards carry the pointer position as CSS variables, which drive their hover glow.
function trackPointer(event: PointerEvent): void {
  const card = (event.target as Element | null)?.closest<HTMLElement>(".VPFeature, .home-tile");
  if (!card) return;
  const bounds = card.getBoundingClientRect();
  card.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
  card.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
}

// Home sections fade in as they enter the viewport. Without JavaScript, or with reduced motion,
// they are simply visible.
function revealOnScroll(): void {
  observer?.disconnect();
  const targets = document.querySelectorAll<HTMLElement>(".home-reveal, .VPFeatures .item");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const target of targets) target.classList.add("is-visible");
    return;
  }

  document.documentElement.classList.add("can-reveal");
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  targets.forEach((target, index) => {
    target.style.setProperty("--reveal-delay", `${(index % 3) * 70}ms`);
    observer?.observe(target);
  });
}

onMounted(() => {
  document.addEventListener("pointermove", trackPointer, { passive: true });
  revealOnScroll();
});

watch(
  () => route.path,
  () => nextTick(revealOnScroll),
);

onBeforeUnmount(() => {
  document.removeEventListener("pointermove", trackPointer);
  observer?.disconnect();
});
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-info-before>
      <HeroBadge />
    </template>
    <template #home-hero-actions-after>
      <HeroStats />
    </template>
    <template #home-hero-image>
      <InvestigationPanel />
    </template>
    <template #layout-bottom>
      <HomeFooter v-if="frontmatter.layout === 'home'" />
    </template>
  </DefaultTheme.Layout>
</template>
