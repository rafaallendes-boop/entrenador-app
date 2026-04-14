import { classifySyncError } from '../syncUtils';

const err1 = { code: '42P01', message: 'relation does not exist' };
console.log('Test 4 error classification:', classifySyncError(err1));

const err2 = Object.assign(new TypeError('test'), { category: 'supabase_not_configured' });
console.log('Test 6 error:', classifySyncError(err2));
