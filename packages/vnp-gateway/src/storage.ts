import fs from 'node:fs/promises'
import path from 'node:path'

export class NDJSONStore {
  constructor(private dir: string) {}

  async append(collection: string, record: unknown): Promise<void> {
    const file = path.join(this.dir, `${collection}.ndjson`)
    await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  }

  async readAll(collection: string): Promise<unknown[]> {
    const file = path.join(this.dir, `${collection}.ndjson`)
    try {
      const content = await fs.readFile(file, 'utf8')
      return content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch {
      return []
    }
  }
}
