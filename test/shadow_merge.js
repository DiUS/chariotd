#!/usr/bin/env node
const shadowMerge = require('../src/shadow_merge.js');
const shadowNormalise = require('../src/shadow_normalise.js');
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
shadowNormalise.enableEmptyArrayDelete(true);
const m3 = shadowMerge({ a: 1 }, { a: [] });
assert.deepEqual(m3, { a: null });
const m3b = shadowMerge({ x: [] }, undefined);
assert.deepEqual(m3b, { x: null });
shadowNormalise.enableEmptyArrayDelete(false);

// Validate non-object replacement merge
const m4 = shadowMerge('str', 'replace');
assert(m4 == 'replace');
