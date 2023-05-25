#!/usr/bin/env node
const BinHeap = require('../src/binheap.js');
const assert = require('assert').strict;

function priocomp(a, b) {
  return a.prio - b.prio;
}

function assertAscendingPrioPop(bh) {
  if (bh.size() == 0)
    return;
  var last = bh.pop().prio;
  while (bh.size() > 0)
  {
    const prio = bh.pop().prio;
    assert(prio >= last);
    last = prio;
  }
}

const bh = new BinHeap(priocomp);
const elems = [10, 3, 4, 8, 2, 9, 7, 8, 1, 2, 6, 5].map(v => ({ prio: v }));

// Basic order check
bh.clear();
elems.forEach(e => bh.insert(e));
assertAscendingPrioPop(bh);


// Check order not messed up by removal of element
for (var i = 0; i <= 12; ++i) {
  bh.clear();
  const x = { prio: i };
  bh.insert(x);
  elems.forEach(e => bh.insert(e));
  assert(bh.removeByIdentity(x) === x);
  var last = null;
  while (bh.size() > 0) {
    const p = bh.pop();
    assert(p !== x); // ensure we really removed it
    if (last == null)
      last = p.prio;
    else {
      assert(p.prio >= last);
      last = p.prio;
    }
  }
}

// Check that removal of non-present item doesn't affect things
bh.clear();
elems.forEach(e => bh.insert(e));
assert(bh.removeByIdentity({ prio: 1 }) === undefined);
assertAscendingPrioPop(bh);


// Verify error if pop on empty
bh.clear();
try { bh.pop(); assert(false); } catch(e) {}

