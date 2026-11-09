import { computed, onBeforeUnmount, ref } from 'vue'

interface ProjectOption {
    id: number
    name: string
    parentTitle?: string
    globalActivities: boolean
}
interface ActivityOption {
    id: number
    name: string
    project: number | null
}
interface Connection {
    api_url: string
    api_token: string
}

export function useBookingSelection(connection: () => Connection, projectId: number, activityId: number) {
    const selectedProjectId = ref(projectId)
    const selectedActivityId = ref(activityId)
    const projects = ref<ProjectOption[]>([])
    const activities = ref<ActivityOption[]>([])
    const loadingOptions = ref(false)
    const optionsError = ref('')
    const loadedConnection = ref('')
    let disposed = false
    let requestId = 0
    let cancelRequest: (() => void) | undefined
    const connectionKey = () => JSON.stringify([connection().api_url.replace(/\/+$/, ''), connection().api_token])
    const selectedProject = computed(() => projects.value.find((project) => project.id === selectedProjectId.value))
    const availableActivities = computed(() => activities.value.filter((activity) => selectedProject.value && (
        activity.project === selectedProject.value.id ||
        (activity.project === null && selectedProject.value.globalActivities !== false)
    )))
    const validSelection = computed(() => loadedConnection.value === connectionKey() &&
        !!selectedProject.value && availableActivities.value.some((activity) => activity.id === selectedActivityId.value))

    function changeProject() {
        if (!availableActivities.value.some((activity) => activity.id === selectedActivityId.value)) {
            selectedActivityId.value = 0
        }
    }

    async function loadOptions() {
        const id = ++requestId
        cancelRequest?.()
        loadingOptions.value = true
        optionsError.value = ''
        loadedConnection.value = ''
        const controller = new AbortController()
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
            const key = connectionKey()
            const { api_url, api_token } = connection()
            if (!api_url || !api_token) throw new Error('Please configure the Kimai URL and API token in Settings.')
            const deadline = new Promise<never>((_, reject) => {
                cancelRequest = () => {
                    reject(new Error('Loading cancelled.'))
                    controller.abort()
                }
                timeout = setTimeout(() => {
                    reject(new Error('Kimai did not respond within 30 seconds. Check your connection or VPN and try again.'))
                    controller.abort()
                }, 30_000)
            })
            const lists = await Promise.race([deadline, Promise.all(['projects?visible=1', 'activities?visible=1'].map(async (path) => {
                const response = await fetch(`${api_url.replace(/\/+$/, '')}/api/${path}`, {
                    headers: { Authorization: `Bearer ${api_token}` },
                    signal: controller.signal,
                })
                if (!response.ok) throw new Error(`Failed to load ${path.split('?')[0]} (HTTP ${response.status}).`)
                const data = await response.json()
                if (!Array.isArray(data)) throw new Error('Invalid project or activity response.')
                return data
            }))])
            if (disposed || id !== requestId || key !== connectionKey()) return
            projects.value = lists[0]
            activities.value = lists[1]
            loadedConnection.value = key
        } catch (error) {
            if (!disposed && id === requestId) optionsError.value = error instanceof Error ? error.message : String(error)
        } finally {
            clearTimeout(timeout)
            controller.abort()
            if (id === requestId) {
                loadingOptions.value = false
                cancelRequest = undefined
            }
        }
    }

    onBeforeUnmount(() => { disposed = true; cancelRequest?.() })
    return { selectedProjectId, selectedActivityId, projects, selectedProject, availableActivities,
        validSelection, loadingOptions, optionsError, changeProject, loadOptions }
}
