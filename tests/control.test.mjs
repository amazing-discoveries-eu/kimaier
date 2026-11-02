import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import dayjs from 'dayjs'
import { computed, ref } from 'vue'

const source = readFileSync(new URL('../src/components/Control.vue', import.meta.url), 'utf8')
const script = source.split('<script setup lang="ts">')[1].split('</script>')[0]
const compiled = ts.transpile(script.replace(/^import .*$/gm, '').replace(/^dayjs.extend.*$/gm, ''), { target: ts.ScriptTarget.ES2022 })
const selectionSource = readFileSync(new URL('../src/composables/useBookingSelection.ts', import.meta.url), 'utf8')
const selectionCompiled = ts.transpile(selectionSource.replace(/^import .*$/gm, '').replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 })
function setup() {
    const state = { user: ref({ api_url: 'https://kimai.test', api_token: 'test', project_id: 1, activity_id: 10 }), authHeader: ref({ Authorization: 'Bearer test' }), isRunning: ref(false), timeCurrent: ref(0), runningActivity: ref([]) }
    let saves = 0
    const requests = []
    const mainStore = { setStore: async () => { saves++ }, getActiveActivity: async () => {} }
    const fetch = async (url, options) => {
        requests.push({ url, options })
        if (options.method === 'POST') return new Response('{}')
        const data = url.includes('/projects') ? [{ id: 1, name: 'One', globalActivities: true }, { id: 2, name: 'Two', globalActivities: false }] : [{ id: 10, name: 'Local one', project: 1 }, { id: 20, name: 'Local two', project: 2 }, { id: 30, name: 'Global', project: null }]
        return new Response(JSON.stringify(data))
    }
    const useBookingSelection = new Function('computed', 'ref', 'onBeforeUnmount', 'fetch', `${selectionCompiled}; return useBookingSelection;`)(computed, ref, () => {}, fetch)
    const component = new Function('dayjs', 'ref', 'computed', 'storeToRefs', 'useMainStore', 'onMounted', 'onBeforeUnmount', 'fetch', 'useBookingSelection', `${compiled}; return {loadOptions,changeProject,setState,availableActivities,validSelection,selectedProjectId,selectedActivityId};`)(dayjs, ref, computed, () => state, () => mainStore, () => {}, () => {}, fetch, useBookingSelection)
    return { ...component, state, requests, get saves() { return saves } }
}
test('filters activities by project and global activity support', async () => {
    const control = setup()
    await control.loadOptions()
    assert.deepEqual(control.availableActivities.value.map(a => a.id), [10, 30])
    control.selectedProjectId.value = 2
    assert.deepEqual(control.availableActivities.value.map(a => a.id), [20])
    control.changeProject()
    assert.equal(control.selectedActivityId.value, 0)
    assert.equal(control.validSelection.value, false)
    control.selectedActivityId.value = 20
    assert.equal(control.state.user.value.project_id, 1)
    assert.equal(control.state.user.value.activity_id, 10)
    assert.equal(control.saves, 0)
})
test('starts with selected IDs and refuses an incompatible activity', async () => {
    const control = setup()
    await control.loadOptions()
    control.selectedProjectId.value = 2
    await control.setState()
    assert.equal(control.requests.filter(r => r.options.method === 'POST').length, 0)
    control.selectedActivityId.value = 20
    await control.setState()
    const post = control.requests.find(r => r.options.method === 'POST')
    const payload = JSON.parse(post.options.body)
    assert.equal(payload.project, 2)
    assert.equal(payload.activity, 20)
    assert.match(payload.begin, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
})

test('returning to Control starts with saved defaults, not the temporary selection', async () => {
    const first = setup()
    await first.loadOptions()
    first.selectedProjectId.value = 2
    first.changeProject()
    first.selectedActivityId.value = 20
    const reopened = setup()
    await reopened.loadOptions()
    assert.equal(reopened.selectedProjectId.value, 1)
    assert.equal(reopened.selectedActivityId.value, 10)
    assert.equal(first.saves, 0)
})

test('Settings persist selected default IDs and names only on Save', async () => {
    const defaults = { api_url: 'https://kimai.test', api_token: 'test', project_id: 1, activity_id: 10, project: 'One', activity: 'Local one' }
    const user = ref({ ...defaults })
    const currentPage = ref(1)
    const state = { user, authHeader: ref({}), currentPage, page: ref({ Control: 0 }) }
    let saved
    const fetch = async (url) => new Response(JSON.stringify(url.includes('/projects')
        ? [{ id: 1, name: 'One', globalActivities: true }, { id: 2, name: 'Two', globalActivities: false }]
        : [{ id: 10, name: 'Local one', project: 1 }, { id: 20, name: 'Local two', project: 2 }]))
    const useBookingSelection = new Function('computed', 'ref', 'onBeforeUnmount', 'fetch', `${selectionCompiled}; return useBookingSelection;`)(computed, ref, () => {}, fetch)
    const settingsSource = readFileSync(new URL('../src/components/Settings.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
    const settingsCompiled = ts.transpile(settingsSource.replace(/^import .*$/gm, ''), { target: ts.ScriptTarget.ES2022 })
    const settings = new Function('ref', 'storeToRefs', 'useMainStore', 'useBookingSelection', 'onMounted', 'setTimeout', `${settingsCompiled}; return {loadOptions,selectedProjectId,selectedActivityId,changeProject,saveSettings};`)(ref, () => state, () => ({ setStore: async () => { saved = { ...user.value } } }), useBookingSelection, () => {}, (fn) => fn())
    await settings.loadOptions()
    settings.selectedProjectId.value = 2
    settings.changeProject()
    assert.equal(settings.selectedActivityId.value, 0)
    settings.selectedActivityId.value = 20
    assert.deepEqual(user.value, defaults)
    assert.equal(saved, undefined)
    await settings.saveSettings()
    assert.equal(saved.project_id, 2)
    assert.equal(saved.activity_id, 20)
    assert.equal(saved.project, 'Two')
    assert.equal(saved.activity, 'Local two')
    assert.equal(currentPage.value, 0)
})
