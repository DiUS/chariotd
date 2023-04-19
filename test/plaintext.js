#!/usr/bin/env node
const pt = require('../src/filefmt/plaintext.js');
const assert = require('assert').strict;

const mytext = "A line\nanother line\n with a leading space\nand trailing space \nplus a blank line\n\n";

assert.deepEqual(mytext, pt.parse(mytext))
assert.deepEqual(mytext, pt.stringify(mytext));

assert.deepEqual("123", pt.parse(123));
assert.deepEqual("123", pt.stringify(123));

assert.deepEqual(null, pt.parse(null));
assert.deepEqual(null, pt.stringify(null));
