<script setup lang="ts">
const steps = [
  {
    tool: "discover",
    input: '{ "query": "checkout" }',
    output: "app-logs · Application logs · time_field=@timestamp",
  },
  {
    tool: "describe_fields",
    input: '{ "source_id": "app-logs", "query": "service" }',
    output: "service.name (keyword, aggregatable)",
  },
  {
    tool: "query",
    input: '{ "mode": "histogram", "text": "timeout", "histogram_interval": "5m" }',
    output: "412 matches, 318 of them between 12:25 and 12:35",
    signal: true,
  },
];

// Matches per five minutes in the synthetic example; the spike is the signal.
const histogram = [6, 9, 7, 11, 8, 124, 194, 31, 10, 7, 5];
const peak = Math.max(...histogram);
</script>

<template>
  <div class="investigation">
    <div class="investigation__glow" aria-hidden="true" />
    <figure class="investigation-panel" aria-label="Synthetic investigation example">
      <header class="investigation-panel__bar">
        <span class="investigation-panel__dot" />
        <span class="investigation-panel__dot" />
        <span class="investigation-panel__dot" />
        <span class="investigation-panel__title">Synthetic investigation example</span>
      </header>
      <ol class="investigation-panel__steps">
        <li
          v-for="(step, index) in steps"
          :key="step.tool"
          :class="{ 'is-signal': step.signal }"
          :style="{ '--step': index }"
        >
          <div class="investigation-panel__call">
            <span class="investigation-panel__tool">{{ step.tool }}</span>
            <code>{{ step.input }}</code>
          </div>
          <div class="investigation-panel__result">{{ step.output }}</div>
          <div v-if="step.signal" class="investigation-panel__histogram" aria-hidden="true">
            <span
              v-for="(count, bucket) in histogram"
              :key="bucket"
              :class="{ 'is-peak': count > peak / 3 }"
              :style="{ '--height': `${Math.max(6, (count / peak) * 100)}%`, '--bar': bucket }"
            />
          </div>
        </li>
      </ol>
      <footer class="investigation-panel__prompt" aria-hidden="true">
        <span>agent</span>
        <span class="investigation-panel__caret" />
      </footer>
    </figure>
    <span class="investigation__chip investigation__chip--top" aria-hidden="true">
      query_echo · app-logs · 60m window
    </span>
  </div>
</template>
