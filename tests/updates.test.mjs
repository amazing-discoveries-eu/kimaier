import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/composables/useAppUpdates.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source.replace(/^import .*$/gm, '').replace(/export /g, ''), { target: ts.ScriptTarget.ES2022 })
function setup(check, invoke = async () => {}) {
    const errors = []
    const install = new Function('check', 'invoke', 'console', `${compiled}; return installStartupUpdate;`)(check, invoke, { error: (...args) => errors.push(args) })
    return { install, errors }
}

test('startup automatically installs and restarts only after installation finishes', async () => {
    const calls = []
    let finishInstall
    const app = setup(async (options) => {
        assert.equal(options.timeout, 30000)
        return {
            downloadAndInstall: (_progress, options) => {
                assert.equal(options.timeout, 60000)
                calls.push('install')
                return new Promise(resolve => { finishInstall = resolve })
            },
            close: async () => calls.push('close'),
        }
    }, async command => calls.push(command))
    const pending = app.install()
    await Promise.resolve()
    assert.deepEqual(calls, ['install'])
    finishInstall()
    await pending
    assert.deepEqual(calls, ['install', 'restart_app', 'close'])
    assert.deepEqual(app.errors, [])
})

test('no update leaves the app running', async () => {
    const app = setup(async () => null, () => assert.fail('Unexpected restart'))
    await app.install()
    assert.deepEqual(app.errors, [])
})

test('check and installation failures do not restart or reject startup', async () => {
    const unavailable = setup(async () => { throw new Error('Offline') }, () => assert.fail('Unexpected restart'))
    await unavailable.install()
    assert.match(String(unavailable.errors[0]), /Offline/)

    let closed = false
    const broken = setup(async () => ({
        downloadAndInstall: async () => { throw new Error('Invalid signature') },
        close: async () => { closed = true },
    }), () => assert.fail('Unexpected restart'))
    await broken.install()
    assert.equal(closed, true)
    assert.match(String(broken.errors[0]), /Invalid signature/)
})

test('startup runs at most once, including concurrent calls', async () => {
    let checks = 0
    let finishCheck
    const app = setup(() => {
        checks++
        return new Promise(resolve => { finishCheck = resolve })
    })
    const first = app.install()
    assert.equal(app.install(), first)
    finishCheck(null)
    await first
    await app.install()
    assert.equal(checks, 1)
})

test('restart failure is logged and the update resource is released', async () => {
    let closed = false
    const app = setup(async () => ({
        downloadAndInstall: async () => {},
        close: async () => { closed = true },
    }), async () => { throw new Error('Restart failed') })
    await app.install()
    assert.equal(closed, true)
    assert.match(String(app.errors[0]), /Restart failed/)
})
