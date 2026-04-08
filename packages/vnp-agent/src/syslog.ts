export interface ParsedSyslog {
  device_id: string
  raw: string
  src_ip: string | null
  port: number | null
  is_auth_failure: boolean
  ts: number
}

const IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})/
const PORT_RE = /port\s+(\d+)/i
const AUTH_FAIL_RE = /failed password|authentication failure|invalid user/i

export function parseSyslog(line: string, device_id: string): ParsedSyslog {
  const ipMatch = line.match(IP_RE)
  const portMatch = line.match(PORT_RE)

  return {
    device_id,
    raw: line,
    src_ip: ipMatch ? ipMatch[1] : null,
    port: portMatch ? parseInt(portMatch[1], 10) : null,
    is_auth_failure: AUTH_FAIL_RE.test(line),
    ts: Math.floor(Date.now() / 1000)
  }
}
