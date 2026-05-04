import { describe, it, expect } from 'vitest'
import { NODE_DEFINITIONS, getNodeDefinition, createFlowNode } from '@nodes/_registry'

describe('registry', () => {
  it('has no duplicate IDs', () => {
    const ids = Object.keys(NODE_DEFINITIONS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('getNodeDefinition', () => {
    it('returns undefined for unknown ID', () => {
      expect(getNodeDefinition('nonexistent-node')).toBeUndefined()
    })
  })

  describe('createFlowNode', () => {
    it('creates a node with defaults populated', () => {
      const node = createFlowNode('agent', { x: 100, y: 200 })
      expect(node.type).toBe('agent')
      expect(node.position).toEqual({ x: 100, y: 200 })
      expect(node.data.name).toBe('')
      expect(node.data.description).toBe('')
      expect(node.data.instructions).toBe('')
    })

    it('throws for unknown node type', () => {
      expect(() => createFlowNode('does-not-exist', { x: 0, y: 0 })).toThrow(
        'Unknown node type: does-not-exist'
      )
    })

    it('creates nodes with unique IDs', () => {
      const a = createFlowNode('agent', { x: 0, y: 0 })
      const b = createFlowNode('agent', { x: 0, y: 0 })
      expect(a.id).not.toBe(b.id)
    })

    it('uses provided ID when given', () => {
      const node = createFlowNode('agent', { x: 0, y: 0 }, 'custom-id')
      expect(node.id).toBe('custom-id')
    })
  })
})
