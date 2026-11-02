<script setup lang="ts">
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useMainStore } from '../stores/main'
import Footer from './Footer.vue'
import helper from '../helpers/helper'
import { calculationStart, getActivities, getHistoricalSeconds } from '../services/timesheets'

dayjs.Ls.en.weekStart = 1
dayjs.extend(timezone)

const {
    user,
    timeToday,
    timeMonth,
    timeWeek,
    timeLeft,
    totalOvertime,
    targetHours,
    todaysActivities,
    monthActivities,
    weekActivities,
} = storeToRefs(useMainStore())
const statisticsTimeout = ref()
const historyEnd = ref()
const workStart = ref()
const totalWorkSeconds = ref(0)
const totalTargetSeconds = ref(0)
const totalTargetToday = ref(0)
let targetThroughToday = 0

const statisticsError = ref('')
const statisticsReady = ref(false)
let disposed = false

function monthStartDay(date: any): number {
    /*
        day of month from which the target hours should be counted,
        prorating the month the user actually started working in
    */
    if (workStart.value && date.isBefore(workStart.value, 'month')) {
        return date.daysInMonth() + 1
    }
    if (workStart.value && date.isSame(workStart.value, 'month')) {
        return workStart.value.date()
    }

    return 1
}

async function getTotalHours(date: any, fromDay: number = 1): Promise<number> {
    /*
        get total target working hour for given month, starting at fromDay
    */
    const daysInMonth = date.daysInMonth()
    const dayHours = user.value.week_hours / user.value.work_days.length
    let currentDay = fromDay
    let weekHours = 0
    let totalHours = 0

    while (daysInMonth >= currentDay) {
        const current = date.date(currentDay)
        const currentDate = current.format('YYYY-MM-DD')

        if (current.format('dd') === 'Mo') {
            totalHours += weekHours
            weekHours = 0
        }

        if (user.value.work_days.includes(current.format('dd')) && weekHours < user.value.week_hours) {
            weekHours += dayHours
        }

        if (currentDate === dayjs().format('YYYY-MM-DD')) {
            totalTargetToday.value = totalHours + weekHours
        }

        currentDay++
    }

    totalHours += weekHours

    return totalHours
}

function getWeekActivities(activities: any[]) {
    let activitiesList = []

    for (const act of activities) {
        const begin = dayjs(act.begin)

        if (dayjs().isSame(begin, 'week')) {
            activitiesList.push(act)
        }
    }

    return activitiesList
}

function setTimer(time: any, activities: any[]): number {
    if (activities.length === 0) {
        return 0
    }

    let timeDiff = 0

    for (const act of activities) {
        const begin = dayjs(act.begin)

        if (act.end) {
            timeDiff += act.duration
        } else {
            timeDiff += time.diff(begin, 'second')
        }
    }

    return timeDiff
}

async function refreshTargets() {
    /*
        (re-)compute target/overtime base values for the current day;
        must be re-run whenever the day (and therefore possibly the month) changes
    */
    const time = dayjs()
    historyEnd.value = dayjs(time.format('YYYY-MM-01T00:00:00'))
    workStart.value = dayjs(`${calculationStart(user.value)}T00:00:00`)

    totalWorkSeconds.value = 0
    totalTargetSeconds.value = 0
    totalTargetToday.value = 0

    targetHours.value = await getTotalHours(time, monthStartDay(time))
    totalWorkSeconds.value = await getHistoricalSeconds({ ...user.value }, time)

    let startDate = workStart.value.startOf('month')

    while (historyEnd.value.isAfter(startDate)) {
        totalTargetSeconds.value += (await getTotalHours(startDate, monthStartDay(startDate))) * 3600
        startDate = startDate.add(1, 'month')
    }

    targetThroughToday = totalTargetSeconds.value + totalTargetToday.value * 3600
}

let currentDate = ''
let lastFetch = 0

async function status() {
    try {
        const time = dayjs()
        const date = time.format('YYYY-MM-DD')
        if (date !== currentDate || Date.now() - lastFetch >= 60_000) {
            const connection = { ...user.value }
            const end = time.format('YYYY-MM-DDT23:59:59')
            const [today, month] = await Promise.all([
                getActivities(connection, time.format('YYYY-MM-DDT00:00:00'), end),
                getActivities(connection, time.format('YYYY-MM-01T00:00:00'), end),
            ])
            if (disposed) return
            if (date !== currentDate) await refreshTargets()
            if (disposed) return
            todaysActivities.value = today
            monthActivities.value = month
            weekActivities.value = getWeekActivities([...month])
            currentDate = date
            lastFetch = Date.now()
        }
        timeToday.value = setTimer(time, todaysActivities.value)
        timeMonth.value = setTimer(time, monthActivities.value)
        timeWeek.value = setTimer(time, weekActivities.value)
        timeLeft.value = targetHours.value * 3600 - timeMonth.value
        const eligibleActivities = monthActivities.value.filter((activity) =>
            !dayjs(activity.begin).isBefore(workStart.value),
        )
        totalOvertime.value = targetThroughToday - (totalWorkSeconds.value + setTimer(time, eligibleActivities))
        statisticsError.value = ''
        statisticsReady.value = true
    } catch (error) {
        statisticsError.value = error instanceof Error ? error.message : String(error)
    } finally {
        if (!disposed) statisticsTimeout.value = setTimeout(status, statisticsError.value ? 60_000 : 1000)
    }
}

onMounted(() => {
    status()
})

onBeforeUnmount(() => {
    disposed = true
    clearTimeout(statisticsTimeout.value)
})
</script>
<template>
    <div class="container">
        <div class="card">
            <p v-if="statisticsError" role="alert">{{ statisticsError }}</p>
            <p v-else-if="!statisticsReady">Loading statistics…</p>
            <div v-else class="table">
                <div class="cell name-col"><strong>Today:</strong></div>
                <div class="cell">{{ helper.secToHMS(timeToday) }}</div>
                <div class="cell name-col"><strong>Week:</strong></div>
                <div class="cell">{{ helper.secToHM(timeWeek) }}</div>
                <div class="cell name-col"><strong>Month:</strong></div>
                <div class="cell">{{ helper.secToHM(timeMonth) }}</div>
                <div class="cell name-col"><strong>Target:</strong></div>
                <div class="cell">{{ targetHours }}</div>
                <div class="cell name-col"><strong>Left:</strong></div>
                <div class="cell">{{ helper.secToHM(timeLeft) }}</div>
                <div class="cell name-col"><strong>Overtime:</strong></div>
                <div class="cell">
                    {{
                        totalOvertime <= 0
                            ? helper.secToHM(Math.abs(totalOvertime))
                            : `-${helper.secToHM(totalOvertime)}`
                    }}
                </div>
            </div>
        </div>

        <Footer />
    </div>
</template>
<style scoped>
* {
    box-sizing: border-box;
}

.table {
    max-width: 165px;
    margin: 0 auto 20px auto;
}
.table:after {
    content: '';
    display: table;
    clear: both;
}
.cell {
    float: left;
    text-align: left;
    padding: 0px 2px 0px 2px;
}

.name-col {
    width: 52%;
    min-width: 80px;
}

@media screen and (max-width: 200px) {
    .container {
        padding-top: 1vh;
    }

    .cell {
        width: 100%;
    }

    .name-col {
        margin-top: 10px;
    }
}
</style>
