/* Copyright(C) 2023 DiUS Computing Pty Ltd */
'use strict';

/* Message queue facility supporting various ways to prioritise messages.
 * new MessageQueue({
 *   concurrency: N,
 *   order: 'lexical'|'reverse-lexical'|'newest-first'|'oldest-first',
 *   jam_timeout: ms
 * });
 * Expects message items to conform to:
 * {
 *   name: string,
 *   timestamp: number, (NOT Date, just a plain ms number)
 *   priority: number, (optional - default is to follow configured 'order')
 *   priority_slot: number | string (optional - default is no priority slot)
 * }
 *
 * Emits:
 *   - 'item' with an added item as its argument.
 *   - 'jammed' if no concurrency slots have become available in a long time
 */

const BinHeap = require('./binheap.js');
const EventEmitter = require('events');

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_UNSPECIFIED_PRIORITY = 1; // for priority_slot w/o priority
const DEFAULT_JAM_TIMEOUT_MS = 5*60*1000;

const sorters = {
  'lexical': (a, b) => a.name.localeCompare(b.name),
  'reverse-lexical': (a, b) => b.name.localeCompare(a.name),
  'newest-first': (a, b) => a.timestamp - b.timestamp,
  'oldest-first': (a, b) => b.timestamp - a.timestamp,
};

class MessageQueue extends EventEmitter {

  constructor(opts) {
    super();

    this._concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
    this._jam_timeout = opts.jam_timeout || DEFAULT_JAM_TIMEOUT_MS;

    this._prio_heap = new BinHeap((a, b) => a.priority - b.priority);
    this._bulk_heap = new BinHeap(sorters[opts.order || 'lexical']);
    this._active_prio_slots = new Map();
    this._pending = new Set();

    this._paused = false;
  }


  add(item) {
    if (item.priority_slot != null) {
      if (typeof(item.priority) != 'number')
        item.priority = DEFAULT_UNSPECIFIED_PRIORITY;

      const cur = this._active_prio_slots.get(item.priority_slot);
      if (cur != undefined)
      {
        // Only replace if actually newer
        if (item.timestamp > cur.timestamp) {
          this._prio_heap.removeByIdentity(cur);
          this._bulk_heap.insert(cur);
          this._add_as_prio(item);
        }
        else
          this._bulk_heap.insert(item);
      }
      else
        this._add_as_prio(item);
    }
    else if (item.priority != null)
      this._prio_heap.insert(item);
    else
      this._bulk_heap.insert(item);

    this._maybe_start_jam_timer();
    this._emit_as_needed();
  }


  complete(item) {
    if (item.priority_slot) {
      const cur = this._active_prio_slots.get(item.priority_slot);
      if (cur === item)
        this._active_prio_slots.delete(item.priority_slot, item);
    }
    this._pending.delete(item);
    this._stop_jam_timer();
    this._emit_as_needed();
  }


  pause() {
    this._paused = true;
    this._stop_jam_timer();
  }


  resume() {
    this._paused = false;
    this._maybe_start_jam_timer();
    this._emit_as_needed();
  }


  clearPending() {
    this._pending.clear();
    this._stop_jam_timer();
    this._emit_as_needed();
  }


  _add_as_prio(item) {
    this._prio_heap.insert(item);
    this._active_prio_slots.set(item.priority_slot, item);
  }

  _emit_as_needed() {
    if (this._paused)
      return;

    while (this._pending.size < this._concurrency) {
      const have_priority = (this._prio_heap.size() > 0);
      const item = have_priority ? this._prio_heap.pop() :
        (this._bulk_heap.size() > 0) ? this._bulk_heap.pop() : null;

      if (item != null) {
        if (item.priority_slot != null &&
            this._active_prio_slots.get(item.priority_slot) === item)
          this._active_prio_slots.delete(item);

        this._pending.add(item);
        // Note: let the publisher know whether this is a priority message
        this.emit('item', item, have_priority);
      }
      else
        break;
    }
  }

  _maybe_start_jam_timer() {
    if (this._paused || this._jam_timer != null)
      return;

    if (this._pending.size == this._concurrency)
      this._jam_timer = setTimeout(
        () => this.emit('jammed'), this._jam_timeout);
  }

  _stop_jam_timer() {
    if (this._jam_timer != null) {
      clearTimeout(this._jam_timer);
      delete(this._jam_timer);
    }
  }
}

module.exports = MessageQueue;
