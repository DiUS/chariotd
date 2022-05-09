#!/usr/bin/env node
const shadowMerge = require('../src/shadow_merge.js');
const assert = require('assert').strict;

// Validate typical merge
const m1 = shadowMerge({
  a: 1,
  b: 2,
  c: {
    d: 'str',
    e: [ 1, 2 ],
    f: {},
  },
  x: 42,
},
{
  a: 2,
  c: {
    d: 11,
    e: [ 2, 4 ],
    f: false,
  },
  x: 'DELETE',
});
assert.deepEqual(m1, {
  a: 2,
  b: 2,
  c: {
    d: 11,
    e: [ 2, 4 ],
    f: false,
  },
  x: null
});

// Validate empty array as non-delete
const m2 = shadowMerge({ a: 1 }, { a: [] });
assert.deepEqual(m2, { a: [] });

// Validate empty array as delete request
shadowMerge.enableEmptyArrayDelete(true);
const m3 = shadowMerge({ a: 1 }, { a: [] });
assert.deepEqual(m3, { a: null });
shadowMerge.enableEmptyArrayDelete(false);
