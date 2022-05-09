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

const diff2 = shadowDiff(null, null);
assert(JSON.stringify(diff2) == '{}');

const diff3 = shadowDiff(null, { key: 'value' });
assert.deepEqual(diff3, { key: 'value' });

const diff4 = shadowDiff({ key: 'value' }, null);
assert(JSON.stringify(diff4) == '{}');

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
