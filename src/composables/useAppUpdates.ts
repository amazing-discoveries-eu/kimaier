import { check } from '@tauri-apps/plugin-updater'
import { invoke } from '@tauri-apps/api/core'

let startupUpdate: Promise<void> | undefined

export function installStartupUpdate(): Promise<void> {
    return startupUpdate ??= installUpdate()
}

async function installUpdate() {
    try {
        const update = await check({ timeout: 30_000 })
        if (!update) return

        try {
            // Kimai keeps the active timesheet running across the app restart.
            await update.downloadAndInstall(undefined, { timeout: 60_000 })
            await invoke('restart_app')
        } finally {
            await update.close()
        }
    } catch (error) {
        // A failed update must not interrupt time tracking or normal startup.
        console.error('Automatic update failed:', error)
    }
}
