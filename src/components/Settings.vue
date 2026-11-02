<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'

import { storeToRefs } from 'pinia'
import { useMainStore } from '../stores/main'
import { getHistoricalSeconds } from '../services/timesheets'
import { useBookingSelection } from '../composables/useBookingSelection'
import { useAppUpdates } from '../composables/useAppUpdates'

const { authHeader, currentPage, page, user, isRunning } = storeToRefs(useMainStore())
const mainStore = useMainStore()

const {
    selectedProjectId, selectedActivityId, projects, selectedProject, availableActivities,
    validSelection, loadingOptions, optionsError, changeProject, loadOptions,
} = useBookingSelection(() => user.value, user.value.project_id, user.value.activity_id)

const { update, phase, updateError, progress, busy: updateBusy, checkForUpdates, installUpdate, restartAfterUpdate } = useAppUpdates()
const appVersion = ref()
const saveMsg = ref('')
const rebuildingCache = ref(false)
const cacheMessage = ref('')

async function rebuildHistory() {
    rebuildingCache.value = true
    cacheMessage.value = ''
    try {
        await getHistoricalSeconds({ ...user.value }, undefined, true)
        cacheMessage.value = 'History updated successfully.'
    } catch (error) {
        cacheMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
        rebuildingCache.value = false
    }
}

const days = ref([
    { name: 'Mo', active: false },
    { name: 'Tu', active: false },
    { name: 'We', active: false },
    { name: 'Th', active: false },
    { name: 'Fr', active: false },
    { name: 'Sa', active: false },
    { name: 'Su', active: false },
])

async function saveSettings() {
    user.value.api_url = user.value.api_url.replace(/\/+$/, '')
    authHeader.value = {
        Authorization: `Bearer ${user.value.api_token}`,
    }

    if (!validSelection.value) {
        saveMsg.value = 'Please load choices and select a default project and activity.'
        return
    }
    user.value.project_id = selectedProjectId.value
    user.value.activity_id = selectedActivityId.value
    user.value.project = selectedProject.value!.name
    user.value.activity = availableActivities.value.find((activity) => activity.id === selectedActivityId.value)!.name

    await mainStore.setStore()

    setTimeout(() => {
        saveMsg.value = ''
        if (user.value.activity !== '' && user.value.project !== '') {
            currentPage.value = page.value.Control
        }
    }, 1000)
}

function activateDay(day: any) {
    day.active = !day.active

    if (day.active && !user.value.work_days.includes(day.name)) {
        user.value.work_days.push(day.name)
    } else if (!day.active && user.value.work_days.includes(day.name)) {
        const index = user.value.work_days.indexOf(day.name)

        user.value.work_days.splice(index, 1)
    }
}

onMounted(async () => {
    if (user.value.api_url && user.value.api_token) loadOptions()
    appVersion.value = await getVersion()

    for (const dayName of user.value.work_days) {
        for (const day of days.value) {
            if (dayName === day.name) {
                day.active = true
            }
        }
    }
})
</script>
<template>
    <div class="container">
        <div class="card">
            <form @submit.prevent="saveSettings()" @reset="currentPage = page.Control">
                <input v-model="user.api_token" type="password" placeholder="API Token" required />
                <input v-model="user.api_url" placeholder="API URL" required />
                <label for="default-project">Default project</label>
                <select id="default-project" v-model="selectedProjectId" :disabled="loadingOptions || rebuildingCache" required @change="changeProject">
                    <option :value="0" disabled>Select project</option>
                    <option v-if="selectedProjectId && !selectedProject" :value="selectedProjectId" disabled>{{ user.project || 'Unavailable project' }}</option>
                    <option v-for="project in projects" :key="project.id" :value="project.id">
                        {{ project.parentTitle ? `${project.parentTitle} / ${project.name}` : project.name }}
                    </option>
                </select>
                <label for="default-activity">Default activity</label>
                <select id="default-activity" v-model="selectedActivityId" :disabled="loadingOptions || rebuildingCache || !selectedProject" required>
                    <option :value="0" disabled>Select activity</option>
                    <option v-if="selectedActivityId && !validSelection" :value="selectedActivityId" disabled>{{ user.activity || 'Unavailable activity' }}</option>
                    <option v-for="activity in availableActivities" :key="activity.id" :value="activity.id">{{ activity.name }}</option>
                </select>
                <button class="reload-choices" type="button" :disabled="loadingOptions || rebuildingCache || !user.api_url || !user.api_token" @click="loadOptions">
                    {{ loadingOptions ? 'Loading…' : 'Load choices' }}
                </button>
                <p v-if="optionsError" role="alert">{{ optionsError }}</p>
                <input v-model="user.week_hours" placeholder="Hours per Week" type="number" tep="0.1" required />
                <label for="work-start">Work start</label>
                <input id="work-start" v-model="user.work_start" type="date" required />
                <label for="count-from">Count from (optional)</label>
                <input id="count-from" v-model="user.count_from" type="date" />

                <div class="day-group">
                    <button
                        v-for="day in days"
                        type="button"
                        key="day.name"
                        class="day-btn"
                        :class="day.active ? 'btn-active' : ''"
                        @click="activateDay(day)"
                    >
                        {{ day.name }}
                    </button>
                </div>

                <div class="btn-group">
                    <button type="reset" :disabled="rebuildingCache">Cancel</button>
                    <button type="submit" :disabled="rebuildingCache || loadingOptions || !validSelection">Save</button>
                </div>
            </form>

            <button
                class="rebuild-cache"
                :disabled="rebuildingCache || !user.api_url || !user.api_token || !user.work_start"
                @click="rebuildHistory"
            >{{ rebuildingCache ? 'Updating history…' : 'Reload history' }}</button>
            <p>Reload past months after editing or deleting older timesheets in Kimai.</p>
            <p v-if="cacheMessage" role="status">{{ cacheMessage }}</p>

            <div class="updates">
                <p>Kimaier v{{ appVersion }}</p>
                <button type="button" :disabled="updateBusy || rebuildingCache || phase === 'installed'" @click="checkForUpdates">
                    {{ phase === 'checking' ? 'Checking…' : 'Check for updates' }}
                </button>
                <p v-if="phase === 'current'" role="status">You are up to date.</p>
                <p v-if="update && phase !== 'installed'">Version {{ update.version }} available.</p>
                <button v-if="phase === 'available'" type="button" :disabled="isRunning === true || rebuildingCache" @click="installUpdate">
                    Install and restart
                </button>
                <p v-if="phase === 'available' && isRunning === true">Stop the timer before installing.</p>
                <p v-if="phase === 'installing'" role="status">Installing update{{ progress === null ? '…' : ` (${progress}%)…` }}</p>
                <button v-if="phase === 'installed'" type="button" @click="restartAfterUpdate">Restart app</button>
                <p v-if="updateError" role="alert">{{ updateError }}</p>
            </div>
        </div>

        <p>{{ saveMsg }}</p>
    </div>
</template>
<style scoped>
label {
    display: block;
    margin-top: 0.5em;
    font-size: 12px;
}

.card p {
    font-size: 12px;
}

.card {
    display: table;
    flex-wrap: wrap;
    align-content: center;
    margin-top: 10px;
    text-align: center;
}

h5 {
    margin-top: 0;
    margin-bottom: 0.2em;
}

input {
    display: block;
    margin: 0.5em auto 0 auto;
}

input {
    width: 70vw;
    height: 20px;
}

button {
    width: 80px;
    margin: 0.5em 0 0 0;
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.day-group > button {
    font-size: 12px;
    margin: 0.7em 0 0 0;
    padding: 1px;
    line-height: 27px;
    width: 25px;
    height: 25px;
    border-radius: 0;
}

.btn-active {
    background-color: rgba(137, 43, 226, 0.521);
}

.day-group > .day-btn:first-child {
    border-top-left-radius: 4px;
    border-bottom-left-radius: 4px;
}

.day-group > .day-btn:last-child {
    border-top-right-radius: 4px;
    border-bottom-right-radius: 4px;
}

select {
    display: block;
    box-sizing: border-box;
    width: 70vw;
    margin: 0.3em auto 0;
    padding: 3px 6px;
    font-size: 12px;
}

.updates button {
    width: auto;
}
.updates p {
    overflow-wrap: anywhere;
}

.reload-choices,
.rebuild-cache {
    width: auto;
}

.btn-group {
    display: flex;
    gap: 1em;
    justify-content: center;
}
</style>
