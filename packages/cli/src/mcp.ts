import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer } from '@aifig/core'
import { callCore, leave } from './client'

export async function runMcpServer() {
  const { server, caller } = buildMcpServer(callCore, (client) => ({ id: `${client}:${process.pid}`, name: process.env.AIFIG_AGENT_NAME ?? '', client, kind: 'agent' }))
  await server.connect(new StdioServerTransport())
  const bye = async () => {
    await leave(caller().id)
    process.exit(0)
  }
  process.stdin.on('close', bye)
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}
