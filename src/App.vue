<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div id="mt-app">
    <RouterView />
  </div>
</template>

<style>
html, body, #app, #mt-app {
  height: 100%;
  margin: 0;
  padding: 0;
}
#mt-app {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
