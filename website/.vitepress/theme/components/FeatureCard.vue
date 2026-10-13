<!--
  Replaces the default VitePress feature card through a Vite alias (see config.ts).

  Layout and interactions (icon beside the title, link with an animated arrow, spotlight that
  follows the pointer) are adapted from vitepress-carbon by Breno A., MIT License:
  https://github.com/brenoepics/vitepress-carbon
-->
<script setup lang="ts">
import type { DefaultTheme } from "vitepress/theme";
import { VPImage, VPLink } from "vitepress/theme";

defineProps<{
  icon?: DefaultTheme.FeatureIcon;
  title: string;
  details?: string;
  link?: string;
  linkText?: string;
  rel?: string;
  target?: string;
}>();
</script>

<template>
  <div class="VPFeature feature-card">
    <div class="feature-card__spotlight" aria-hidden="true" />
    <VPLink
      class="feature-card__body"
      :href="link"
      :rel="rel"
      :target="target"
      :no-icon="true"
      :tag="link && !linkText ? 'a' : 'div'"
    >
      <div class="feature-card__header">
        <VPImage
          v-if="typeof icon === 'object'"
          :image="icon"
          :alt="icon.alt"
          :height="icon.height || 40"
          :width="icon.width || 40"
        />
        <div v-else-if="icon" class="feature-card__icon" v-html="icon" />
        <h2 class="feature-card__title" v-html="title" />
      </div>
      <p v-if="details" class="feature-card__details" v-html="details" />
      <VPLink
        v-if="linkText"
        class="feature-card__link"
        :href="link"
        :rel="rel"
        :target="target"
        :no-icon="true"
        :tag="link ? 'a' : 'div'"
      >
        {{ linkText }}
        <svg
          class="feature-card__arrow"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6.75 3.75 4.25 4.25-4.25 4.25"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            class="feature-card__arrow-shaft"
            d="M1.75 8H11"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </VPLink>
    </VPLink>
  </div>
</template>

<style scoped>
.feature-card {
  position: relative;
  display: block;
  overflow: hidden;
  height: 100%;
  padding: 1.25rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 40%),
    var(--vp-c-bg-soft);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

/* A blurred disc of the signal colour, revealed around the pointer. */
.feature-card__spotlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--vp-c-brand-1);
  filter: blur(90px);
  mix-blend-mode: soft-light;
  mask-image: radial-gradient(
    11rem at var(--pointer-x, -999px) var(--pointer-y, -999px),
    #fff,
    transparent
  );
  opacity: 0;
  transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.feature-card:hover .feature-card__spotlight {
  opacity: 1;
}

.feature-card__body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
}

.feature-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.feature-card__icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent);
  border-radius: 9px;
  background: var(--kmcp-signal-soft);
  color: var(--vp-c-brand-1);
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.feature-card__icon :deep(svg) {
  width: 1.1rem;
  height: 1.1rem;
}

.feature-card:hover .feature-card__icon {
  border-color: var(--vp-c-brand-1);
  transform: scale(1.06);
}

.feature-card__title {
  margin: 0;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.35;
  transition: color 0.2s ease;
}

.feature-card:hover .feature-card__title {
  color: var(--vp-c-brand-1);
}

.feature-card__details {
  flex-grow: 1;
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.6;
}

.feature-card__link {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.4rem;
  padding-bottom: 0.1em;
  background: linear-gradient(currentColor 0 0) bottom left / 0 1px no-repeat;
  color: var(--vp-c-text-1);
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
  transition: background-size 0.4s ease, color 0.2s ease;
}

.feature-card__link:hover {
  background-size: 100% 1px;
  color: var(--vp-c-brand-1);
}

.feature-card__arrow {
  transition: transform 0.2s ease;
}

.feature-card__link:hover .feature-card__arrow {
  transform: translateX(4px);
}

.feature-card__arrow-shaft {
  stroke-dasharray: 10;
  stroke-dashoffset: 10;
  transition: stroke-dashoffset 0.2s ease;
}

.feature-card__link:hover .feature-card__arrow-shaft {
  stroke-dashoffset: 20;
}

.feature-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, var(--vp-c-divider));
  box-shadow: 0 10px 28px rgba(4, 10, 19, 0.28);
  transform: translateY(-2px);
}

.feature-card:has(a:focus-visible) {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .feature-card,
  .feature-card__icon,
  .feature-card__arrow,
  .feature-card__spotlight {
    transition: none;
  }

  .feature-card:hover,
  .feature-card:hover .feature-card__icon {
    transform: none;
  }
}
</style>
