import { describe, it, expect } from 'vitest'
import { canConnect, getSocketStyle, SOCKET_TYPES } from '../sockets'
import type { SocketTypeId, Parameter } from '@nodes/_types'

const ALL_SOCKET_TYPES: SocketTypeId[] = ['agent', 'tools', 'float', 'int', 'string', 'boolean', 'color']

/** Helper to build a minimal Parameter for canConnect tests */
function makeParam(socketType: SocketTypeId, acceptsTypes?: readonly SocketTypeId[]): Parameter {
  return {
    id: 'test',
    type: socketType as Parameter['type'],
    label: 'Test',
    mode: 'input',
    socket: { type: socketType },
    ...(acceptsTypes ? { acceptsTypes } : {}),
  } as Parameter
}

describe('SOCKET_TYPES registry', () => {
  it.each(ALL_SOCKET_TYPES)('has an entry for %s', (typeId) => {
    expect(SOCKET_TYPES[typeId]).toBeDefined()
    expect(SOCKET_TYPES[typeId].id).toBe(typeId)
    expect(SOCKET_TYPES[typeId].color).toBeTypeOf('string')
    expect(SOCKET_TYPES[typeId].shape).toBeTypeOf('string')
  })
})

describe('canConnect', () => {
  it.each(ALL_SOCKET_TYPES)('allows same-type connection for %s', (typeId) => {
    expect(canConnect(typeId, makeParam(typeId))).toBe(true)
  })

  const incompatiblePairs: [SocketTypeId, SocketTypeId][] = [
    ['agent', 'float'],
    ['tools', 'string'],
    ['int', 'boolean'],
    ['color', 'agent'],
    ['float', 'tools'],
  ]

  it.each(incompatiblePairs)(
    'rejects %s -> %s',
    (source, target) => {
      expect(canConnect(source, makeParam(target))).toBe(false)
    }
  )

  it('allows connection when source is in acceptsTypes', () => {
    const param = makeParam('tools', ['tools', 'agent'])
    expect(canConnect('agent', param)).toBe(true)
  })

  it('rejects connection when source is not in acceptsTypes', () => {
    const param = makeParam('tools', ['tools', 'agent'])
    expect(canConnect('float', param)).toBe(false)
  })
})

describe('getSocketStyle', () => {
  it.each(ALL_SOCKET_TYPES)('returns color and shape for %s', (typeId) => {
    const style = getSocketStyle(typeId)
    expect(style.color).toBe(SOCKET_TYPES[typeId].color)
    expect(style.shape).toBe(SOCKET_TYPES[typeId].shape)
  })

  it('applies color override', () => {
    const style = getSocketStyle('agent', { color: '#ff0000' })
    expect(style.color).toBe('#ff0000')
    expect(style.shape).toBe(SOCKET_TYPES.agent.shape)
  })

  it('applies shape override', () => {
    const style = getSocketStyle('boolean', { shape: 'circle' })
    expect(style.color).toBe(SOCKET_TYPES.boolean.color)
    expect(style.shape).toBe('circle')
  })

  it('applies both overrides', () => {
    const style = getSocketStyle('float', { color: '#abc', shape: 'square' })
    expect(style.color).toBe('#abc')
    expect(style.shape).toBe('square')
  })
})
