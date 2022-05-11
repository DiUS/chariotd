#!/usr/bin/env node
const sh = require('../src/filefmt/shell.js');
const assert = require('assert').strict;

const everything = {
  a: 1,
  b: "str",
  c: "with spaces",
  d: "with single ' quote",
  e: 'with double " quote',
  f: true,
  g: false,
  h: -64.2,
  i: [ 1, 2, 3 ],
  j: [ 'x ', 'y ', ' z' ],
  k: [],
  l: "",
  nested: {
    x: {
      y: {
        z1: [ true ],
        z2: 'something else',
      },
      yy: 42,
    }
  },
};

assert.deepEqual(everything, sh.parse(sh.stringify(everything)));

const unsupported_keep_numbers_as_strings = { a: ' 1' };
assert.notDeepEqual(unsupported_keep_numbers_as_strings, sh.parse(sh.stringify(unsupported_keep_numbers_as_strings)));
const ensure_no_nulls = { a: null };
assert.notDeepEqual(ensure_no_nulls, sh.parse(sh.stringify(ensure_no_nulls)));

// Validate no surplus null elements from array
assert.deepEqual(sh.parse("arr=('G'  'G' )"), { arr: [ 'G', 'G' ] });
