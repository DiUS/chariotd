/* Copyright(C) 2023 DiUS Computing Pty Ltd */
'use strict';

class BinHeap {

  constructor(cmpfn) {
    this._cmp = cmpfn;
    this.clear();
  }

  clear() {
    this._a = [ null ];
  }

  size() {
    return this._a.length - 1;
  }

  pop() {
    if (this.size() == 0)
      throw new Error('empty binheap');

    return this._extract(1);
  }

  insert(e) {
    this._a.push(e);
    this._float(this.size());
  }

  removeByIdentity(e) {
    for (var idx = 1; idx <= this.size(); ++idx)
      if (e === this._a[idx])
        return this._extract(idx);
  }

  _extract(idx) {
    const size = this.size();
    const e = this._a[idx];
    const last = this._a.pop();
    if (size > idx) {
      this._a[idx] = last;
      this._float(idx);
      this._sink(idx);
    }
    return e;
  }

  _float(idx) {
    const e = this._a[idx];
    while (idx > 1) {
      const pidx = this._parentIdx(idx);
      const p = this._a[pidx];
      if (this._cmp(e, p) >= 0)
        break; // parent is ordered before element
      // else swap up
      this._a[pidx] = e;
      this._a[idx] = p;
      idx = pidx;
    }
  }

  _sink(pidx) {
    while(this._hasLeft(pidx)) {
      const smallerIdx =
        this._hasRight(pidx) &&
        this._cmp(
          this._a[this._rightIdx(pidx)],
          this._a[this._leftIdx(pidx)]) < 0
        ? this._rightIdx(pidx) : this._leftIdx(pidx);

      if (this._cmp(this._a[pidx], this._a[smallerIdx]) < 0)
        break;

      this._swap(pidx, smallerIdx);
      pidx = smallerIdx;
    }
  }

  _parentIdx(idx) {
    return (idx / 2) >> 0; // integer div
  }

  _siblingIdx(idx) {
    if (idx % 1 > 0)
      return idx - 1;
    else
      return idx + 1;
  }

  _hasSibling(idx) {
    const sidx = this._siblingIdx(idx);
    return sidx > 0 && sidx <= this.size();
  }

  _leftIdx(pidx) {
    return pidx * 2;
  }

  _rightIdx(pidx) {
    return pidx * 2 + 1;
  }

  _hasLeft(pidx) {
    return this._leftIdx(pidx) <= this.size();
  }

  _hasRight(pidx) {
    return this._rightIdx(pidx) <= this.size();
  }

  _swap(idx1, idx2) {
    const tmp = this._a[idx1];
    this._a[idx1] = this._a[idx2];
    this._a[idx2] = tmp;
  }

}

module.exports = BinHeap;
