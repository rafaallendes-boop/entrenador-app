import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const CURRENT_KEY_VERSION = 1

const IV_BYTES = 12

function resolveKey(keyB64?: string): Buffer {
  const raw = keyB64 ?? process.env['WHOOP_TOKEN_ENC_KEY']
  if (!raw) throw new Error('WHOOP_TOKEN_ENC_KEY is not configured')

  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('WHOOP_TOKEN_ENC_KEY must be 32 bytes (base64)')
  }
  return key
}

export function encryptToken(plaintext: string, keyB64?: string): string {
  const key = resolveKey(keyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
}

export function decryptToken(encoded: string, keyB64?: string): string {
  const key = resolveKey(keyB64)
  const [ivB64, tagB64, cipherB64] = encoded.split('.')
  if (!ivB64 || !tagB64 || !cipherB64) throw new Error('Malformed encrypted token')

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function decryptTokenForVersion(encoded: string, keyVersion: number): string {
  if (keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported key_version ${keyVersion}`)
  }
  return decryptToken(encoded)
}
