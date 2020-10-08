#!/usr/bin/env node
const json = require('../src/filefmt/json.js');
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

assert.deepEqual(everything, json.parse(json.stringify(everything)));

const ensure_no_nulls = { a: null };
assert.notDeepEqual(ensure_no_nulls, json.parse(json.stringify(ensure_no_nulls)));
