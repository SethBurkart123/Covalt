import { describe, it, expect } from 'vitest'
import {
  NODE_DEFINITIONS,
  getNodeDefinition,
  getNodesByCategory,
  createFlowNode,
} from '@nodes/_registry'

const EXPECTED_NODE_IDS = ['chat-start', 'agent', 'mcp-server', 'toolset', 'llm-completion', 'prompt-template', 'conditional', 'model-selector']

describe('registry', () => {
  it.each(EXPECTED_NODE_IDS)('has %s registered', (id) => {
    expect(NODE_DEFINITIONS[id]).toBeDefined()
  })

  it('has no duplicate IDs', () => {
    const ids = Object.keys(NODE_DEFINITIONS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('getNodeDefinition', () => {
    it.each(EXPECTED_NODE_IDS)('returns correct definition for %s', (id) => {
      const def = getNodeDefinition(id)
      expect(def).toBeDefined()
      expect(def!.id).toBe(id)
    })

    it('returns undefined for unknown ID', () => {
      expect(getNodeDefinition('nonexistent-node')).toBeUndefined()
    })
  })

  describe('getNodesByCategory', () => {
    it('returns core nodes', () => {
      const coreNodes = getNodesByCategory('core')
      const coreIds = coreNodes.map(n => n.id)
      expect(coreIds).toContain('chat-start')
      expect(coreIds).toContain('agent')
    })

    it('returns tools nodes', () => {
      const toolNodes = getNodesByCategory('tools')
      const toolIds = toolNodes.map(n => n.id)
      expect(toolIds).toContain('mcp-server')
      expect(toolIds).toContain('toolset')
    })

    it('returns utility nodes', () => {
      const utilNodes = getNodesByCategory('utility')
      const utilIds = utilNodes.map(n => n.id)
      expect(utilIds).toContain('model-selector')
    })

    it('returns empty array for unused category', () => {
      expect(getNodesByCategory('rag')).toEqual([])
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
