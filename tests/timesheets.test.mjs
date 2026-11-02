import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import dayjs from 'dayjs'

const source = readFileSync(new URL('../src/services/timesheets.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source.replace(/^import .*$/gm, '').replace(/export /g, ''), {
    target: ts.ScriptTarget.ES2022,
})
const connection = { api_url: 'https://kimai.test', api_token: 'secret', work_start: '2024-06-15' }
const now = dayjs('2026-11-02T12:00:00')
const entry = (id, duration = 3600) => ({ id, duration, begin: '2026-10-05T09:00:00+0200', end: '2026-10-05T10:00:00+0200' })
const json = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { headers, status })

function setup(responses, cache = new Map(), userId = 5) {
    const calls = []
    let writes = 0
    const fetch = async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer secret')
        if (url.endsWith('/users/me')) return json({ id: userId })
        calls.push(new URL(url))
        assert.ok(responses.length, `Unexpected request: ${url}`)
        return responses.shift()
    }
    const invoke = async (command, args) => {
        if (command === 'read_timesheet_cache') return cache.get(args.scope) ?? null
        assert.equal(command, 'write_timesheet_cache')
        cache.set(args.scope, args.history)
        writes++
    }
    const service = new Function('dayjs', 'invoke', 'fetch', `${compiled}; return { getActivities, getHistoricalSeconds };`)(dayjs, invoke, fetch)
    return { ...service, calls, cache, get writes() { return writes } }
}

test('loads all pages and preserves date filters', async () => {
    const service = setup([json(Array.from({ length: 500 }, (_, id) => entry(id)), { 'X-Total-Pages': '2' }), json([entry(500)], { 'X-Total-Pages': '2' })])
    const result = await service.getActivities(connection, '2024-06-15T00:00:00', '2026-10-31T23:59:59')
    assert.equal(result.length, 501)
    assert.deepEqual(service.calls.map(url => url.searchParams.get('page')), ['1', '2'])
    for (const url of service.calls) {
        assert.equal(url.searchParams.get('size'), '500')
        assert.equal(url.searchParams.get('begin'), '2024-06-15T00:00:00')
        assert.equal(url.searchParams.get('end'), '2026-10-31T23:59:59')
    }
})

test('handles a full last page without visible pagination headers', async () => {
    const service = setup([json(Array.from({ length: 500 }, (_, id) => entry(id))), json({}, {}, 404)])
    assert.equal((await service.getActivities(connection, 'begin', 'end')).length, 500)
})

test('initial history spans years, excludes current month and is reused', async () => {
    const service = setup([json([entry(1), entry(2, 7200)])])
    assert.equal(await service.getHistoricalSeconds(connection, now), 10800)
    assert.equal(service.calls[0].searchParams.get('begin'), '2024-06-15T00:00:00')
    assert.equal(service.calls[0].searchParams.get('end'), '2026-10-31T23:59:59')
    assert.equal(await service.getHistoricalSeconds(connection, now), 10800)
    assert.equal(service.calls.length, 1)
    assert.equal(service.writes, 1)
    assert.ok(!JSON.stringify([...service.cache.keys()]).includes('secret'))
})

test('month rollover only adds the newly completed month', async () => {
    const service = setup([json([entry(1)]), json([entry(2, 7200)])])
    await service.getHistoricalSeconds(connection, now)
    assert.equal(await service.getHistoricalSeconds(connection, dayjs('2026-12-01')), 10800)
    assert.equal(service.calls[1].searchParams.get('begin'), '2026-11-01T00:00:00')
    assert.equal(service.calls[1].searchParams.get('end'), '2026-11-30T23:59:59')
})

test('manual rebuild replaces rather than adds history, including deletions', async () => {
    const service = setup([json([entry(1)]), json([])])
    await service.getHistoricalSeconds(connection, now)
    assert.equal(await service.getHistoricalSeconds(connection, now, true), 0)
    assert.equal(service.writes, 2)
})

test('failed rebuild leaves the existing cache intact', async () => {
    const service = setup([json([entry(1)]), json({}, {}, 500)])
    await service.getHistoricalSeconds(connection, now)
    await assert.rejects(service.getHistoricalSeconds(connection, now, true), /HTTP 500/)
    assert.equal(await service.getHistoricalSeconds(connection, now), 3600)
    assert.equal(service.writes, 1)
})

test('a failed later page cannot commit incomplete history', async () => {
    const service = setup([json(Array.from({ length: 500 }, (_, id) => entry(id)), { 'X-Total-Pages': '2' }), json({}, {}, 404)])
    await assert.rejects(service.getHistoricalSeconds(connection, now), /HTTP 404/)
    assert.equal(service.writes, 0)
})

test('separates users, servers and employment start dates', async () => {
    const cache = new Map()
    const first = setup([json([entry(1)])], cache)
    await first.getHistoricalSeconds(connection, now)
    const second = setup([json([entry(2, 7200)])], cache, 6)
    assert.equal(await second.getHistoricalSeconds(connection, now), 7200)
    const third = setup([json([])], cache)
    assert.equal(await third.getHistoricalSeconds({ ...connection, api_url: 'https://other.test' }, now), 0)
    const fourth = setup([json([])], cache)
    await fourth.getHistoricalSeconds({ ...connection, work_start: '2025-01-01' }, now)
    assert.equal(cache.size, 4)
})

test('does not cache a running entry or invalid API data', async () => {
    for (const data of [[{ ...entry(1), end: null }], [{ ...entry(1), duration: null }], { error: 'invalid' }]) {
        const service = setup([json(data)])
        await assert.rejects(service.getHistoricalSeconds(connection, now))
        assert.equal(service.writes, 0)
    }
})

test('no historical fetch is needed when employment begins this month', async () => {
    const service = setup([])
    assert.equal(await service.getHistoricalSeconds({ ...connection, work_start: '2026-11-01' }, now), 0)
    assert.equal(service.calls.length, 0)
    assert.equal(service.writes, 0)
})

test('count from overrides work start and has an independent cache', async () => {
    const service = setup([json([entry(1)]), json([entry(2, 7200)])])
    await service.getHistoricalSeconds(connection, now)
    const configured = { ...connection, count_from: '2025-07-15' }
    assert.equal(await service.getHistoricalSeconds(configured, now), 7200)
    assert.equal(service.calls[1].searchParams.get('begin'), '2025-07-15T00:00:00')
    assert.equal(service.cache.size, 2)
    assert.equal(await service.getHistoricalSeconds(configured, now), 7200)
})

test('empty count from uses the original work start and cache', async () => {
    const service = setup([json([entry(1)])])
    await service.getHistoricalSeconds(connection, now)
    assert.equal(await service.getHistoricalSeconds({ ...connection, count_from: '' }, now), 3600)
    assert.equal(service.calls.length, 1)
})

test('count from in the current month or future requires no historical fetch', async () => {
    const service = setup([])
    for (const count_from of ['2026-11-02', '2027-01-01']) {
        assert.equal(await service.getHistoricalSeconds({ ...connection, count_from }, now), 0)
    }
    assert.equal(service.calls.length, 0)
})
