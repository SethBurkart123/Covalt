import { describe, it, expect } from 'vitest'
import { NODE_DEFINITIONS } from '@nodes/_registry'
import type { NodeDefinition } from '@nodes/_types'
import { SOCKET_TYPES } from '../sockets'

const nodeEntries = Object.entries(NODE_DEFINITIONS)

describe('node contracts', () => {
  it.each(nodeEntries)('%s has unique parameter IDs', (_id, node: NodeDefinition) => {
    const ids = node.parameters.map(p => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it.each(nodeEntries)('%s socket configs use valid socket types', (_id, node: NodeDefinition) => {
    for (const param of node.parameters) {
      if (param.socket) {
        expect(param.socket.type in SOCKET_TYPES).toBe(true)
      }
      if (param.acceptsTypes) {
        for (const type of param.acceptsTypes) {
          expect(type in SOCKET_TYPES).toBe(true)
        }
      }
    }
  })
})
