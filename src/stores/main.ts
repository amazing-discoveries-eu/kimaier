import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

import { defineStore } from 'pinia'
import { LazyStore } from '@tauri-apps/plugin-store'

dayjs.extend(utc)
dayjs.extend(timezone)

interface Header {
    Authorization: string
}

enum Page {
    Control,
    Settings,
    Statistics,
}

interface User {
    api_token: string
    api_url: string
    project: string
    activity: string
    week_hours: number
    project_id: number
    activity_id: number
    state: string
    work_days: string[]
    count_from: string
    work_start: string
}

export const useMainStore = defineStore('main', {
    state: () => ({
        store: new LazyStore('kimaier.dat'),
        page: Page,
        user: {
            api_token: '',
            api_url: '',
            project: '',
            activity: '',
            week_hours: 0,
            project_id: 0,
            activity_id: 0,
            state: '',
            work_days: [],
            work_start: '',
            count_from: '',
        } as User,
        allActivities: [] as any[],
        authHeader: {} as Header,
        currentPage: Page.Settings,
        isRunning: null as boolean | null,
        timeCurrent: 0,
        timeToday: 0,
        timeMonth: 0,
        timeWeek: 0,
        targetHours: 0,
        timeLeft: 0,
        totalOvertime: 0,
        runningActivity: [] as any[],
        todaysActivities: [] as any[],
        monthActivities: [] as any[],
        weekActivities: [] as any[],
    }),
    getters: {},

    actions: {
        async getStore() {
            await this.store
                .get('user')
                .then((data: any) => {
                    if (data) {
                        if (!data.work_days) {
                            data.work_days = []
                        }
                        const apiToken = data.api_token || data.api_pass || ''
                        this.user = {
                            ...this.user,
                            ...data,
                            api_token: apiToken,
                        }
                        this.currentPage = Page.Control
                        this.authHeader = {
                            Authorization: `Bearer ${apiToken}`,
                        }
                    }
                })
                .catch(() => (this.currentPage = Page.Settings))
        },

        async setStore() {
            await this.store.set('user', this.user).then(() => {
                setTimeout(() => {
                    this.store.save()
                }, 100)
            })
        },

        async getActiveActivity() {
            await fetch(`${this.user.api_url}/api/timesheets/active`, {
                method: 'GET',
                headers: new Headers({ 'Content-Type': 'application/json', ...this.authHeader }),
            })
                .then((response) => response.json())
                .then((data) => {
                    if (data && data.length > 0) {
                        this.runningActivity = data
                        this.isRunning = true
                    } else {
                        this.isRunning = false
                        this.runningActivity = []
                    }
                })
                .catch(() => {
                    this.isRunning = false
                    this.runningActivity = []
                })
        },

        async setActivities() {
            await fetch(`${this.user?.api_url}/api/activities`, {
                method: 'GET',
                headers: new Headers({ 'Content-Type': 'application/json', ...this.authHeader }),
            })
                .then((response) => response.json())
                .then((data) => {
                    this.allActivities = data
                })
                .catch((e) => {
                    alert(e)
                })
        },
    },
})
