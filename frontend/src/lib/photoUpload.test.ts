import { describe, expect, it } from 'vitest'

import { chunk, photoContentType, rejectReason } from './photoUpload'

describe('photoContentType', () => {
  it('trusts known image types', () => {
    expect(photoContentType({ name: 'a.bin', type: 'image/jpeg' })).toBe('image/jpeg')
  })
  it('falls back to the extension when the browser gives no type (HEIC on Chrome)', () => {
    expect(photoContentType({ name: 'IMG_0001.HEIC', type: '' })).toBe('image/heic')
    expect(photoContentType({ name: 'pic.JPG', type: '' })).toBe('image/jpeg')
  })
  it('rejects other formats', () => {
    expect(photoContentType({ name: 'a.png', type: 'image/png' })).toBeNull()
  })
})

describe('rejectReason', () => {
  it('checks type and size', () => {
    expect(rejectReason({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(rejectReason({ name: 'a.png', type: 'image/png', size: 1000 })).toMatch(/JPEG/)
    expect(rejectReason({ name: 'a.jpg', type: 'image/jpeg', size: 26 * 1024 * 1024 })).toMatch(
      /25 MB/,
    )
  })
})

it('chunks lists', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunk([], 50)).toEqual([])
})
