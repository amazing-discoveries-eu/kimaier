import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, ref, shallowRef } from 'vue'

const source = readFileSync(new URL('../src/composables/useAppUpdates.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source.replace(/^import .*$/gm, '').replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 })
function setup(check, invoke = async () => {}) {
    return new Function('computed', 'ref', 'shallowRef', 'check', 'invoke', `${compiled}; return useAppUpdates();`)(computed, ref, shallowRef, check, invoke)
}
test('reports no update and surfaces endpoint errors', async () => {
    const current = setup(async () => null)
    await current.checkForUpdates()
    assert.equal(current.phase.value, 'current')
    const broken = setup(async () => { throw new Error('HTTP 404') })
    await broken.checkForUpdates()
    assert.equal(broken.phase.value, 'idle')
    assert.match(broken.updateError.value, /HTTP 404/)
})
test('checks, installs with progress, and restarts only after installation', async () => {
    const calls = []
    const update = { version: '0.15.0', close: async () => {}, downloadAndInstall: async (progress) => {
        calls.push('install')
        progress({ event: 'Started', data: { contentLength: 100 } })
        progress({ event: 'Progress', data: { chunkLength: 50 } })
    } }
    const app = setup(async (options) => { assert.equal(options.timeout, 30000); return update }, async (command) => calls.push(command))
    await app.checkForUpdates()
    assert.equal(app.phase.value, 'available')
    await app.installUpdate()
    assert.equal(app.phase.value, 'installed')
    assert.equal(app.progress.value, 50)
    assert.deepEqual(calls, ['install', 'restart_app'])
})
test('failed installation can be retried and never restarts', async () => {
    let restarts = 0
    const app = setup(async () => ({ close: async () => {}, downloadAndInstall: async () => { throw new Error('signature mismatch') } }), async () => restarts++)
    await app.checkForUpdates()
    await app.installUpdate()
    assert.equal(app.phase.value, 'available')
    assert.match(app.updateError.value, /signature mismatch/)
    assert.equal(restarts, 0)
})
test('restart failure keeps installed state; retry does not reinstall', async () => {
    let installs = 0
    let restarts = 0
    const app = setup(async () => ({ close: async () => {}, downloadAndInstall: async () => installs++ }), async () => { if (++restarts === 1) throw new Error('restart failed') })
    await app.checkForUpdates()
    await app.installUpdate()
    assert.equal(app.phase.value, 'installed')
    assert.match(app.updateError.value, /restart failed/)
    await app.installUpdate()
    await app.restartAfterUpdate()
    assert.equal(installs, 1)
    assert.equal(restarts, 2)
    assert.equal(app.updateError.value, '')
})
test('concurrent checks and installs are ignored', async () => {
    let finishCheck, finishInstall
    let checks = 0
    let installs = 0
    const app = setup(() => { checks++; return new Promise(resolve => { finishCheck = resolve }) })
    const pending = app.checkForUpdates()
    await app.checkForUpdates()
    assert.equal(checks, 1)
    finishCheck({ close: async () => {}, downloadAndInstall: () => { installs++; return new Promise(resolve => { finishInstall = resolve }) } })
    await pending
    const installing = app.installUpdate()
    await app.installUpdate()
    await app.checkForUpdates()
    assert.equal(installs, 1)
    assert.equal(checks, 1)
    finishInstall()
    await installing
})
test('rechecking releases the previous update resource', async () => {
    let closes = 0
    const app = setup(async () => ({ close: async () => closes++ }))
    await app.checkForUpdates()
    await app.checkForUpdates()
    assert.equal(closes, 1)
})
