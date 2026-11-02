import dayjs from 'dayjs'
import { invoke } from '@tauri-apps/api/core'

export interface TimesheetConnection {
    api_url: string
    api_token: string
    count_from?: string
    work_start: string
}

export function calculationStart(connection: TimesheetConnection): string {
    return connection.count_from || connection.work_start
}

interface CachedHistory {
    coveredUntil: string
    totalSeconds: number
}

export interface Timesheet {
    id: number
    begin: string
    end: string | null
    duration: number
}

async function apiGet(connection: TimesheetConnection, path: string): Promise<Response> {
    return fetch(`${connection.api_url.replace(/\/+$/, '')}/api/${path}`, {
        headers: { Authorization: `Bearer ${connection.api_token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
    })
}

export async function getActivities(
    connection: TimesheetConnection,
    begin: string,
    end: string,
): Promise<Timesheet[]> {
    const list: Timesheet[] = []
    const pageSize = 500
    const params = new URLSearchParams({ begin, end, size: String(pageSize), order: 'ASC' })
    let totalPages = 0
    for (let page = 1; ; page++) {
        params.set('page', String(page))
        const response = await apiGet(connection, `timesheets?${params}`)
        // If pagination headers are unavailable, a full final page needs one more request.
        if (page > 1 && totalPages === 0 && response.status === 404) break
        if (!response.ok) throw new Error(`Failed to load timesheets (HTTP ${response.status}).`)
        const data = await response.json()
        if (!Array.isArray(data) || data.some((entry) =>
            !Number.isInteger(entry.id) || typeof entry.begin !== 'string' ||
            !Number.isFinite(entry.duration) || entry.duration < 0,
        )) {
            throw new Error('Invalid timesheets response.')
        }
        list.push(...data)
        totalPages = Number(response.headers.get('X-Total-Pages'))
        if (data.length === 0 || (totalPages > 0 ? page >= totalPages : data.length < pageSize)) break
    }
    return list
}

// Only finished months are cached. Existing history is refreshed exclusively on request.
export async function getHistoricalSeconds(
    connection: TimesheetConnection,
    now = dayjs(),
    rebuild = false,
): Promise<number> {
    const startDate = calculationStart(connection)
    const start = dayjs(`${startDate}T00:00:00`)
    if (!start.isValid()) throw new Error('Please configure a valid calculation start date.')
    const boundary = now.startOf('month')
    if (!start.isBefore(boundary)) return 0

    const response = await apiGet(connection, 'users/me')
    if (!response.ok) throw new Error(`Failed to identify Kimai user (HTTP ${response.status}).`)
    const user = await response.json()
    if (!Number.isInteger(user.id)) throw new Error('Invalid Kimai user response.')
    const scope = JSON.stringify([connection.api_url.replace(/\/+$/, ''), user.id, startDate])
    const cached = rebuild ? null : await invoke<CachedHistory | null>('read_timesheet_cache', { scope })
    if (cached && (!Number.isSafeInteger(cached.totalSeconds) || cached.totalSeconds < 0)) {
        throw new Error('Invalid history cache. Please rebuild it in Settings.')
    }
    const coveredUntil = cached ? dayjs(cached.coveredUntil) : start
    if (!coveredUntil.isValid() || coveredUntil.isAfter(boundary) || coveredUntil.isBefore(start)) {
        throw new Error('Invalid history cache. Please rebuild it in Settings.')
    }
    if (coveredUntil.isSame(boundary)) return cached!.totalSeconds

    const activities = await getActivities(connection,
        coveredUntil.format('YYYY-MM-DDTHH:mm:ss'),
        boundary.subtract(1, 'second').format('YYYY-MM-DDTHH:mm:ss'),
    )
    if (activities.some((activity) => !activity.end)) {
        throw new Error('Please stop the running timesheet from a previous month before loading history.')
    }
    const totalSeconds = (cached?.totalSeconds ?? 0) +
        activities.reduce((total, activity) => total + activity.duration, 0)
    await invoke('write_timesheet_cache', {
        scope,
        history: { coveredUntil: boundary.format('YYYY-MM-DDTHH:mm:ss'), totalSeconds },
    })
    return totalSeconds
}
