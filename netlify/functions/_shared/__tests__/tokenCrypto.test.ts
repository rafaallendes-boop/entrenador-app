import { beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { CURRENT_KEY_VERSION, decryptToken, encryptToken } from '../tokenCrypto'

const KEY = randomBytes(32).toString('base64')

describe('tokenCrypto', () => {
  beforeEach(() => {
    process.env['WHOOP_TOKEN_ENC_KEY'] = KEY
  })

  it('round-trips a token', () => {
    const secret = 'whoop_access_token_abc123'
    const enc = encryptToken(secret)
    expect(enc).not.toContain(secret)
    expect(decryptToken(enc)).toBe(secret)
  })

  it('produces a unique IV per call', () => {
    const a = encryptToken('same')
    const b = encryptToken('same')
    expect(a).not.toBe(b)
    expect(decryptToken(a)).toBe('same')
    expect(decryptToken(b)).toBe('same')
  })

  it('fails to decrypt a tampered ciphertext', () => {
    const enc = encryptToken('tamper-me')
    const [iv, tag, cipher] = enc.split('.')
    const broken = [iv, tag, Buffer.from(`00${cipher}`, 'base64').toString('base64')].join('.')
    expect(() => decryptToken(broken)).toThrow()
  })

  it('exposes a current key version', () => {
    expect(CURRENT_KEY_VERSION).toBe(1)
  })
})
