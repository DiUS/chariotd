#!/usr/bin/env node
const shadowDiff = require('../src/shadow_diff.js');
const assert = require('assert').strict;

const old = {
  svc1: {
    obj: {
      key: 'value',
      arr: [ 1, 2 ],
      value: 42,
    },
    value: 2,
    string: 'str',
    array: [ 'a', 'b' ],
  },
  svc2: {
    key2: 'value',
  },
  svc3: false,
  svc4: [ 23, 34 ],
  svc5: {
    key5: 'value',
  },
  svc6: false,
  svc7: {
    untouched: true,
  },
  svc8: {
    not: 'present',
  },
};


const new1 = {
  svc1: {
    obj: {
      key: 'value',
      arr: [ 1, 2 ],
      value: 43,
    },
    value: 3,
    string: 'str2',
    array: [ 'a', 'c' ],
  },
  svc2: {
    newkey: 'value',
    key2: null,
  },
  svc3: true,
  svc4: [ 23, 34, 56 ],
  svc5: "type-change",
  svc6: null,
  svc7: {
    untouched: true,
  },
};


const diff1 = shadowDiff(old, new1);
assert.deepEqual(diff1, {
  svc1: {
    obj: {
      value: 43,
    },
    value: 3,
    string: 'str2',
    array: [ 'a', 'c' ],
  },
  svc2: {
    newkey: 'value',
    key2: null,
  },
  svc3: true,
  svc4: [23, 34, 56 ],
  svc5: "type-change",
  svc6: null,
  svc8: null,
});

assert.deepEqual(shadowDiff({}, {}), undefined);

assert.deepEqual(shadowDiff(null, { key: 'value' }), { key: 'value' });
assert.deepEqual(shadowDiff(undefined, { key: 'value' }), { key: 'value' });

assert.deepEqual(shadowDiff({ key: 'value' }, undefined), undefined);

const diff5 = shadowDiff({ a: { going: true } }, { a: {} });
assert.deepEqual(diff5, { a: { going: null }});

const diff6 = shadowDiff({ a: 1 }, 'type-change');
assert(diff6 == 'type-change');

const diff7 = shadowDiff({ a: { b: 1 }}, { a: 'str' });
assert.deepEqual(diff7, { a: 'str' });

const diff8 = shadowDiff({ a: 1 }, [ 1, 2, 3 ]);
assert.deepEqual(diff8, [ 1, 2, 3 ]);

const diff9 = shadowDiff({ key: [ 1, 2, 3 ] }, { key: { a: 1, b: 2 }});
assert.deepEqual(diff9, { key: { a: 1, b: 2 }});

// Validate delta merge regression fix
const diff10_a = { svc: { key: {           } } };
const diff10_b = { svc: { key: { sub: null } } };
const diff10 = shadowDiff(diff10_a, diff10_b);
assert.deepEqual(diff10, diff10_b);

// Validate null->array merge regression fix
const diff11 = shadowDiff({ key: { sub: null } }, { key: { sub: [ {} ] } });
assert.deepEqual(diff11, { key: { sub: [ {} ] } });

// Validate null diff on top-level non-object values
assert.deepEqual(shadowDiff('xyz', 'xyz'), undefined);
assert.deepEqual(shadowDiff(42, 42), undefined);
assert.deepEqual(shadowDiff(true, true), undefined);
assert.deepEqual(shadowDiff(null, null), undefined);
assert.deepEqual(shadowDiff([], []), undefined);
