import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'

import { sameLook } from '@/components/map/sameLook'

const pin = (label: string, color: string) =>
  createElement(
    'View',
    { style: [{ padding: 4 }, { backgroundColor: color }], onPress: () => {} },
    createElement('Text', { numberOfLines: 1 }, label),
  )

describe('sameLook', () => {
  test('a re-render with fresh callbacks, styles and children draws the same', () => {
    expect(sameLook(pin('Home', 'red'), pin('Home', 'red'))).toBe(true)
  })

  test('a changed prop anywhere in the tree is a new look', () => {
    expect(sameLook(pin('Home', 'red'), pin('Home', 'blue'))).toBe(false)
    expect(sameLook(pin('Home', 'red'), pin('Work', 'red'))).toBe(false)
  })

  test('a different component or key is a new look', () => {
    const A = () => null
    const B = () => null
    expect(sameLook(createElement(A), createElement(B))).toBe(false)
    expect(sameLook(createElement(A, { key: 1 }), createElement(A, { key: 2 }))).toBe(false)
  })

  test('data props compare by value, not identity', () => {
    const cluster = () => ({ coordinate: [1, 2], assets: [{ uri: 'a.jpg' }] })
    expect(
      sameLook(
        createElement('X', { cluster: cluster() }),
        createElement('X', { cluster: cluster() }),
      ),
    ).toBe(true)
    expect(
      sameLook(
        createElement('X', { cluster: cluster() }),
        createElement('X', { cluster: { ...cluster(), assets: [{ uri: 'b.jpg' }] } }),
      ),
    ).toBe(false)
  })

  test('trees deeper than the limit count as changed', () => {
    let a: unknown = 1
    let b: unknown = 1
    for (let i = 0; i < 40; i++) {
      a = { a }
      b = { a: b }
    }
    expect(sameLook(a, b)).toBe(false)
  })
})
