import { join } from 'node:path'

// Use the configured official endpoint without exposing its credential-bearing URL.
let endpoint = ''

async function main() {
  const [method, input, imageOutput] = process.argv.slice(2)
  if (!['tools/list', 'tools/call'].includes(method ?? '') || (method === 'tools/call' && !input)) {
    throw new Error('Usage: bun penpot.ts tools/list | tools/call INPUT.js|INPUT.json [IMAGE.png]')
  }
  const configHome = process.env.CODEX_HOME ?? join(process.env.HOME!, '.codex')
  const config = await Bun.file(join(configHome, 'config.toml')).text()
  const section = config.match(/^\[mcp_servers\.penpot\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1]
  const rawUrl = section?.match(/^url\s*=\s*(".*")\s*$/m)?.[1]
  if (!rawUrl) throw new Error('No URL configured under mcp_servers.penpot.')
  endpoint = JSON.parse(rawUrl)
  if (new URL(endpoint).protocol !== 'https:') throw new Error('Expected an HTTPS Penpot endpoint.')
  const params = input
    ? input.endsWith('.js')
      ? { name: 'execute_code', arguments: { code: await Bun.file(input).text() } }
      : await Bun.file(input).json()
    : {}
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  async function request(id: number, rpcMethod: string, rpcParams: unknown) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method: rpcMethod, params: rpcParams }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Penpot HTTP ${response.status}; operation not retried.`)
    const session = response.headers.get('mcp-session-id')
    if (session) headers['Mcp-Session-Id'] = session
    const body = await response.text()
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n\r?\n/).flatMap((event) => {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          return data ? [JSON.parse(data)] : []
        })
      : [JSON.parse(body)]
    const reply = messages.find((message) => message.id === id)
    if (!reply) throw new Error('No matching MCP reply; inspect state before retrying a mutation.')
    if (reply.error) throw new Error(`MCP error ${reply.error.code}: ${reply.error.message}`)
    return reply.result
  }
  await request(0, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vescape-designs', version: '1' },
  })
  const result = await request(1, method!, params)
  if (!result.content) console.log(JSON.stringify(result, null, 2))
  let imageIndex = 0
  for (const content of result.content ?? []) {
    if (content.type === 'text') console.log(content.text)
    else if (content.type === 'image') {
      if (!imageOutput) throw new Error('Image returned; supply an output path to save the export.')
      if (imageIndex++) throw new Error('Multiple images returned; choose a single-board export.')
      await Bun.write(imageOutput, Buffer.from(content.data, 'base64'))
      console.log(`Saved image: ${imageOutput}`)
    }
  }
  if (
    result.isError ||
    result.content?.some(
      (content: { type: string; text?: string }) =>
        content.type === 'text' && content.text?.startsWith('Tool execution failed:'),
    )
  )
    throw new Error('Penpot tool failed; inspect state before retrying a mutation.')
}

main().catch((error) => {
  let message = error instanceof Error ? error.message : 'Penpot client failed.'
  if (endpoint) message = message.replaceAll(endpoint, '[configured Penpot endpoint]')
  console.error(message)
  process.exitCode = 1
})
