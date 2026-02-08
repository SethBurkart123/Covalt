import { describe, it, expect } from 'vitest'
import { canConnect, canCoerce, getSocketStyle, SOCKET_TYPES } from '../sockets'
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

describe('canCoerce', () => {
  it.each(ALL_SOCKET_TYPES)('identity: %s → %s is always true', (typeId) => {
    expect(canCoerce(typeId, typeId)).toBe(true)
  })

  const validCoercions: [SocketTypeId, SocketTypeId][] = [
    ['int', 'float'],
    ['int', 'string'],
    ['float', 'string'],
    ['boolean', 'string'],
    ['string', 'text'],
    ['text', 'string'],
    ['json', 'string'],
    ['json', 'text'],
    ['message', 'text'],
    ['message', 'string'],
    ['message', 'json'],
    ['document', 'text'],
    ['document', 'json'],
  ]

  it.each(validCoercions)(
    'allows %s → %s',
    (source, target) => {
      expect(canCoerce(source, target)).toBe(true)
    }
  )

  it('any target accepts everything', () => {
    for (const src of ['int', 'string', 'json', 'message', 'binary'] as SocketTypeId[]) {
      expect(canCoerce(src, 'any')).toBe(true)
    }
  })

  it('any source connects everywhere', () => {
    for (const tgt of ['int', 'string', 'json', 'float', 'text'] as SocketTypeId[]) {
      expect(canCoerce('any', tgt)).toBe(true)
    }
  })

  const invalidCoercions: [SocketTypeId, SocketTypeId][] = [
    ['boolean', 'float'],
    ['binary', 'string'],
    ['vector', 'int'],
    ['trigger', 'json'],
    ['agent', 'string'],
    ['tools', 'text'],
  ]

  it.each(invalidCoercions)(
    'rejects %s → %s',
    (source, target) => {
      expect(canCoerce(source, target)).toBe(false)
    }
  )
})

describe('canConnect with coercion', () => {
  const coerciblePairs: [SocketTypeId, SocketTypeId][] = [
    ['int', 'float'],
    ['string', 'text'],
    ['text', 'string'],
    ['message', 'text'],
    ['json', 'string'],
  ]

  it.each(coerciblePairs)(
    'allows %s → %s via implicit coercion',
    (source, target) => {
      expect(canConnect(source, makeParam(target))).toBe(true)
    }
  )

  it('acceptsTypes overrides coercion — rejects coercible type not in list', () => {
    // int→float is coercible, but if acceptsTypes only allows string, it's rejected
    const param = makeParam('float', ['string'])
    expect(canConnect('int', param)).toBe(false)
  })

  it('acceptsTypes overrides coercion — allows listed type even if not coercible', () => {
    // boolean→float is not coercible, but acceptsTypes explicitly allows it
    const param = makeParam('float', ['boolean', 'float'])
    expect(canConnect('boolean', param)).toBe(true)
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
