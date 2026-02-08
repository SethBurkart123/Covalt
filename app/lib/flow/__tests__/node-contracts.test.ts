import { describe, it, expect } from 'vitest'
import { NODE_DEFINITIONS } from '@nodes/_registry'
import type { NodeDefinition, SocketTypeId, ParameterMode, NodeCategory } from '@nodes/_types'

const VALID_SOCKET_TYPES: SocketTypeId[] = [
  'agent', 'tools', 'float', 'int', 'string', 'boolean', 'color',
  'json', 'text', 'binary', 'array', 'message', 'document', 'vector', 'trigger', 'any',
]
const VALID_MODES: ParameterMode[] = ['constant', 'hybrid', 'input', 'output']
const VALID_CATEGORIES: NodeCategory[] = ['core', 'tools', 'data', 'utility', 'ai', 'flow', 'integration', 'rag']

const nodeEntries = Object.entries(NODE_DEFINITIONS)

describe('node contracts', () => {
  it.each(nodeEntries)('%s has all required fields', (_id, node: NodeDefinition) => {
    expect(node.id).toBeTypeOf('string')
    expect(node.id.length).toBeGreaterThan(0)
    expect(node.name).toBeTypeOf('string')
    expect(node.name.length).toBeGreaterThan(0)
    expect(VALID_CATEGORIES).toContain(node.category)
    expect(node.icon).toBeTypeOf('string')
    expect(node.icon.length).toBeGreaterThan(0)
    expect(Array.isArray(node.parameters)).toBe(true)
  })

  it.each(nodeEntries)('%s has unique parameter IDs', (_id, node: NodeDefinition) => {
    const ids = node.parameters.map(p => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it.each(nodeEntries)('%s parameters have valid modes', (_id, node: NodeDefinition) => {
    for (const param of node.parameters) {
      expect(VALID_MODES).toContain(param.mode)
    }
  })

  it.each(nodeEntries)('%s socket configs use valid socket types', (_id, node: NodeDefinition) => {
    for (const param of node.parameters) {
      if (param.socket) {
        expect(VALID_SOCKET_TYPES).toContain(param.socket.type)
      }
      if (param.acceptsTypes) {
        for (const t of param.acceptsTypes) {
          expect(VALID_SOCKET_TYPES).toContain(t)
        }
      }
    }
  })

  it.each(nodeEntries)('%s has at least one socket parameter', (_id, node: NodeDefinition) => {
    const socketParams = node.parameters.filter(p => p.socket !== undefined)
    expect(socketParams.length).toBeGreaterThanOrEqual(1)
  })

  it.each(nodeEntries)('%s socket parameters are not mode constant', (_id, node: NodeDefinition) => {
    for (const param of node.parameters) {
      if (param.socket) {
        expect(param.mode).not.toBe('constant')
      }
    }
  })
})
