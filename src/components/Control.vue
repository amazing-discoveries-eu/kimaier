<script setup lang="ts">
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '../stores/main'
import Footer from './Footer.vue'
import helper from '../helpers/helper'
import { useBookingSelection } from '../composables/useBookingSelection'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const { user, authHeader, isRunning, timeCurrent, runningActivity } = storeToRefs(useMainStore())
const mainStore = useMainStore()

const controlTimeout = ref()

const {
    selectedProjectId,
    selectedActivityId,
    projects,
    selectedProject,
    availableActivities,
    validSelection,
    loadingOptions,
    optionsError,
    changeProject,
    loadOptions,
} = useBookingSelection(() => user.value, user.value.project_id, user.value.activity_id)
const changingState = ref(false)
const controlError = ref('')
let disposed = false
const selectionDisabled = computed(() => isRunning.value !== false || loadingOptions.value || changingState.value)

function setTimer(time: any) {
    if (runningActivity.value.length === 0 && timeCurrent.value !== 0) {
        timeCurrent.value = 0
    }

    for (const act of runningActivity.value) {
        const begin = dayjs(act.begin, 'YYYY-MM-DDTHH:mm:ss+000ZZ')
        const diff = time.diff(begin, 'second')
        timeCurrent.value = diff
    }
}

async function status() {
    await mainStore.getActiveActivity()

    async function setStatus(resolve: any) {
        /*
            recursive function as a endless loop
        */
        const time = dayjs()
        setTimer(time)

        if (time.unix() % 60 === 0) {
            await mainStore.getActiveActivity()
        }

        if (disposed) return
        controlTimeout.value = setTimeout(() => setStatus(resolve), 1000)
    }
    return new Promise((resolve) => setStatus(resolve))
}

async function setState() {
    if (changingState.value || isRunning.value === null) return
    if (!isRunning.value && (!validSelection.value || loadingOptions.value)) return
    changingState.value = true
    controlError.value = ''
    try {
        await changeState()
    } catch (error) {
        controlError.value = error instanceof Error ? error.message : String(error)
    } finally {
        changingState.value = false
    }
}

async function changeState() {
    if (isRunning.value) {
        for (const activity of runningActivity.value) {
            await fetch(`${user.value.api_url}/api/timesheets/${activity.id}/stop`, {
                method: 'PATCH',
                headers: new Headers({ 'Content-Type': 'application/json', ...authHeader.value }),
            }).then((response) => {
                if (!response.ok) throw new Error(`Failed to stop timesheet (HTTP ${response.status}).`)
                if (response.ok) {
                    isRunning.value = false
                    runningActivity.value = []
                }
            })
        }
    } else {
        await fetch(`${user.value.api_url}/api/timesheets`, {
            method: 'POST',
            headers: new Headers({ 'Content-Type': 'application/json', ...authHeader.value }),
            body: JSON.stringify({
                begin: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
                end: '',
                project: selectedProjectId.value,
                activity: selectedActivityId.value,
                description: '',
                tags: '',
            }),
        }).then(async (response) => {
            if (!response.ok) throw new Error(`Failed to start timesheet (HTTP ${response.status}).`)
            if (response.ok) {
                isRunning.value = true
                await mainStore.getActiveActivity()
            }
        })
    }
}

onMounted(() => {
    status()
    loadOptions()
})

onBeforeUnmount(() => {
    disposed = true
    clearTimeout(controlTimeout.value)
})
</script>
<template>
    <div class="container">
        <div class="card">
            <button
                id="control-button"
                type="button"
                :disabled="changingState || isRunning === null || (!isRunning && (loadingOptions || !validSelection))"
                @click="setState()"
            >
                <div v-if="isRunning === true" class="circle-pause">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                        <!--! Font Awesome Free 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. -->
                        <path
                            d="M200 160C186.8 160 176 170.8 176 184v144C176 341.3 186.8 352 200 352S224 341.3 224 328v-144C224 170.8 213.3 160 200 160zM312 160C298.8 160 288 170.8 288 184v144c0 13.25 10.75 24 24 24s24-10.75 24-24v-144C336 170.8 325.3 160 312 160zM256 0C114.6 0 0 114.6 0 256s114.6 256 256 256s256-114.6 256-256S397.4 0 256 0zM256 464c-114.7 0-208-93.31-208-208S141.3 48 256 48s208 93.31 208 208S370.7 464 256 464z"
                        />
                    </svg>
                </div>
                <div v-else-if="isRunning === false" class="circle-play">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                        <!--! Font Awesome Free 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. -->
                        <path
                            d="M188.3 147.1C195.8 142.8 205.1 142.1 212.5 147.5L356.5 235.5C363.6 239.9 368 247.6 368 256C368 264.4 363.6 272.1 356.5 276.5L212.5 364.5C205.1 369 195.8 369.2 188.3 364.9C180.7 360.7 176 352.7 176 344V167.1C176 159.3 180.7 151.3 188.3 147.1V147.1zM512 256C512 397.4 397.4 512 256 512C114.6 512 0 397.4 0 256C0 114.6 114.6 0 256 0C397.4 0 512 114.6 512 256zM256 48C141.1 48 48 141.1 48 256C48 370.9 141.1 464 256 464C370.9 464 464 370.9 464 256C464 141.1 370.9 48 256 48z"
                        />
                    </svg>
                </div>
            </button>

            <div class="timer">{{ helper.secToHMS(timeCurrent) }}</div>
            <div class="selection">
                <select
                    id="control-project"
                    v-model="selectedProjectId"
                    :disabled="selectionDisabled"
                    @change="changeProject"
                >
                    <option :value="0" disabled>Select project</option>
                    <option v-if="selectedProjectId && !selectedProject" :value="selectedProjectId" disabled>
                        {{ user.project || 'Unavailable project' }}
                    </option>
                    <option v-for="project in projects" :key="project.id" :value="project.id">
                        {{ project.parentTitle ? `${project.parentTitle} / ${project.name}` : project.name }}
                    </option>
                </select>
                <select
                    id="control-activity"
                    v-model="selectedActivityId"
                    :disabled="selectionDisabled || !selectedProject"
                >
                    <option :value="0" disabled>Select activity</option>
                    <option v-if="selectedActivityId && !validSelection" :value="selectedActivityId" disabled>
                        {{ user.activity || 'Unavailable activity' }}
                    </option>
                    <option v-for="activity in availableActivities" :key="activity.id" :value="activity.id">
                        {{ activity.name }}
                    </option>
                </select>
                <p v-if="loadingOptions">Loading projects and activities…</p>
                <p v-else-if="selectedProject && !availableActivities.length">No activities available.</p>
                <p v-if="optionsError || controlError" role="alert">{{ optionsError || controlError }}</p>
                <button v-if="optionsError && !loadingOptions" type="button" @click="loadOptions">
                    Reload choices
                </button>
            </div>
        </div>

        <Footer />
    </div>
</template>

<style scoped>
.selection {
    width: 100%;
    margin: 10px auto 0;
    text-align: left;
}
.selection label {
    display: block;
    font-size: 12px;
}
.selection select {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin-bottom: 6px;
    font-size: 12px;
}
.selection p {
    font-size: 12px;
    overflow-wrap: anywhere;
}
button:disabled,
select:disabled {
    opacity: 0.55;
}
#control-button {
    width: 80vw;
    height: 80vw;
    line-height: 80vw;
    padding: 0;
}

#control-button svg {
    width: 70vw;
    height: 70vw;
    vertical-align: middle;
}

.circle-play svg {
    fill: green;
}
.circle-pause svg {
    fill: orange;
}
</style>
