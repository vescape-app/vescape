import { describe, expect, test } from 'bun:test'

import { parseReleaseTags } from './plan'

describe('release tag parsing', () => {
  test('keeps version tags and ignores unrelated ones', () => {
    expect(
      parseReleaseTags(
        [
          'v0.85.0 930CD36DDF3D147C14CC0F60591ACDE409B9A903',
          'pr-116-screenshots aaaabbbbccccddddeeeeffff0000111122223333',
          'production-0.83.1 09b3d1caeee3abd99a5936877492aece621bbbc7',
          'production-bad 09b3d1caeee3abd99a5936877492aece621bbbc7',
          'v0.84.3 1111111111111111111111111111111111111111 8f971ac9900280f8b0ed110b9bd254f9fe561c04',
        ].join('\n'),
      ),
    ).toEqual([
      { tagName: 'v0.85.0', sha: '930cd36ddf3d147c14cc0f60591acde409b9a903' },
      { tagName: 'production-0.83.1', sha: '09b3d1caeee3abd99a5936877492aece621bbbc7' },
      { tagName: 'v0.84.3', sha: '8f971ac9900280f8b0ed110b9bd254f9fe561c04' },
    ])
  })

  test('rejects malformed tag metadata', () => {
    expect(() => parseReleaseTags('v0.85.0')).toThrow('Invalid tag metadata')
  })
})
