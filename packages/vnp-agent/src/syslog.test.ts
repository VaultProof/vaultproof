import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSyslog } from './syslog.js'

describe('syslog parser', () => {
  it('parses a standard syslog line with IP and message', () => {
    const line = '<14>Apr  8 12:00:01 router-1 kernel: connection from 192.168.1.50 port 22'
    const result = parseSyslog(line, 'router-1')
    assert.equal(result.device_id, 'router-1')
    assert.ok(result.raw.includes('connection from'))
    assert.equal(result.src_ip, '192.168.1.50')
  })

  it('parses failed login message', () => {
    const line = '<14>Apr  8 12:00:01 router-1 sshd: Failed password for root from 10.0.0.5 port 22 ssh2'
    const result = parseSyslog(line, 'router-1')
    assert.equal(result.src_ip, '10.0.0.5')
    assert.equal(result.is_auth_failure, true)
  })

  it('extracts port number when present', () => {
    const line = '<14>Apr  8 12:00:01 host sshd: Received connection from 1.2.3.4 port 443'
    const result = parseSyslog(line, 'host')
    assert.equal(result.port, 443)
  })

  it('returns null src_ip when no IP found', () => {
    const line = '<14>Apr  8 12:00:01 host kernel: system startup complete'
    const result = parseSyslog(line, 'host')
    assert.equal(result.src_ip, null)
    assert.equal(result.is_auth_failure, false)
  })
})
