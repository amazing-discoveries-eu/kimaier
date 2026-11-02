import { computed, ref, shallowRef } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'

// Shared across views so leaving Settings cannot start a second installation.
const update = shallowRef<Update | null>(null)
const phase = ref<'idle' | 'checking' | 'available' | 'current' | 'installing' | 'installed'>('idle')
const updateError = ref('')
const progress = ref<number | null>(null)
const busy = computed(() => phase.value === 'checking' || phase.value === 'installing')

async function checkForUpdates() {
    if (busy.value || phase.value === 'installed') return
    phase.value = 'checking'
    updateError.value = ''
    try {
        if (update.value) await update.value.close()
        update.value = null
        update.value = await check({ timeout: 30_000 })
        phase.value = update.value ? 'available' : 'current'
    } catch (error) {
        phase.value = 'idle'
        updateError.value = `Update check failed: ${String(error)}`
    }
}

async function restartAfterUpdate() {
    if (phase.value !== 'installed') return
    updateError.value = ''
    try {
        await invoke('restart_app')
    } catch (error) {
        updateError.value = `Update installed. Please restart the app: ${String(error)}`
    }
}

async function installUpdate() {
    if (busy.value || phase.value !== 'available' || !update.value) return
    phase.value = 'installing'
    updateError.value = ''
    progress.value = null
    let downloaded = 0
    let total = 0
    try {
        await update.value.downloadAndInstall((event) => {
            if (event.event === 'Started') {
                total = event.data.contentLength ?? 0
                downloaded = 0
            } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength
                progress.value = total > 0 ? Math.min(100, Math.round(downloaded / total * 100)) : null
            }
        }, { timeout: 60_000 })
        phase.value = 'installed'
        await restartAfterUpdate()
    } catch (error) {
        phase.value = 'available'
        updateError.value = `Update installation failed: ${String(error)}`
    }
}

export function useAppUpdates() {
    return { update, phase, updateError, progress, busy, checkForUpdates, installUpdate, restartAfterUpdate }
}
