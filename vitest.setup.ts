// Provides a real IndexedDB implementation in Node tests so Dexie schema,
// upgrade, and compound-index behavior can be exercised.
import 'fake-indexeddb/auto'
import { beforeEach } from 'vitest'
import { setAccountRole } from './src/services/entitlements/accountRoleHolder'

// Most pre-role tests describe the existing single-athlete session. Production
// deliberately starts `unknown` and fails closed until bootstrap resolves the
// role; the test harness makes that legacy fixture explicit instead of letting
// one test's holder state leak into the next. Tests for `unknown` set it
// locally before their assertion.
beforeEach(() => setAccountRole('athlete'))
