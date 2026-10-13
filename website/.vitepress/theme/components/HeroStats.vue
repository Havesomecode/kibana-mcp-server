<script setup lang="ts">
const stats = [
  { value: "5", label: "investigation tools" },
  { value: "6", label: "query modes" },
  { value: "5", label: "catalog stores" },
];
</script>

<template>
  <dl class="hero-stats">
    <div v-for="stat in stats" :key="stat.label" class="hero-stats__item">
      <dt>{{ stat.label }}</dt>
      <dd>{{ stat.value }}</dd>
    </div>
  </dl>
</template>
