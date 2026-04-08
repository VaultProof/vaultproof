import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { NDJSONStore } from './storage.js'

describe('NDJSONStore', () => {
  let dir: string
  let store: NDJSONStore

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vnp-test-'))
    store = new NDJSONStore(dir)
  })

  after(async () => {
    await fs.rm(dir, { recursive: true })
  })

  it('appends and reads back an event', async () => {
    const event = { v: '1.0', type: 'EVENT', id: 'evt_abc', ts: 1000 }
    await store.append('events', event)
    const lines = await store.readAll('events')
    assert.equal(lines.length, 1)
    assert.deepEqual(lines[0], event)
  })

  it('appends multiple records', async () => {
    const store2 = new NDJSONStore(dir)
    await store2.append('multi', { a: 1 })
    await store2.append('multi', { a: 2 })
    await store2.append('multi', { a: 3 })
    const lines = await store2.readAll('multi')
    assert.equal(lines.length, 3)
  })
})
