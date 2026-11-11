<script setup lang="ts">
import { onMounted } from 'vue'
import Control from './components/Control.vue'
import Settings from './components/Settings.vue'
import Statistics from './components/Statistics.vue'

import { storeToRefs } from 'pinia'
import { useMainStore } from './stores/main'
import { installStartupUpdate } from './composables/useAppUpdates'

const { currentPage, user, page } = storeToRefs(useMainStore())
const mainStore = useMainStore()

onMounted(async () => {
    await mainStore.getStore()
    if (import.meta.env.PROD) void installStartupUpdate()
    if (
        !user.value ||
        user.value.activity_id === 0 ||
        !user.value.week_hours ||
        user.value.week_hours === 0 ||
        user.value.work_days.length === 0
    ) {
        currentPage.value = page.value.Settings
    } else {
        currentPage.value = page.value.Control
    }
})
</script>
<template>
    <div>
        <Control v-if="currentPage === page.Control" />
        <Statistics v-else-if="currentPage === page.Statistics" />
        <Settings v-else />
    </div>
</template>
