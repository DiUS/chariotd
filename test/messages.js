#!/usr/bin/env node
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const assert = require('assert').strict;
const EventEmitter = require('events');
const MessagePublisher = require('../src/message_publisher.js');
const merge = require('../src/merge.js');

class TestAdapter extends EventEmitter {

  setExpectations(expected_items) {
    this._exp = expected_items;
  }

  publish(topic, msg, opts) {
    assert(this._exp.length > 0);
    const e = this._exp.shift();

    if (e.compress == 'deflate')
      msg = zlib.inflateSync(msg).toString();

    assert.equal(topic, e.topic);
    assert.deepStrictEqual(msg, e.payload);
    assert.deepStrictEqual(opts, e.opts);

    return Promise.resolve();
  }

  connect() {
    this.emit('connected');
  }

  disconnect() {
    this.emit('disconnected');
  }
};

function set_mtime_order(dir, fnames) {
  const base = new Date().getTime();
  for (var t = base - fnames.length; fnames.length > 0; t = t + 1) {
    const fname = fnames.shift();
    const d = new Date(t);
    fs.utimesSync(`${dir}/${fname}`, d, d);
  }
}

function u2e(x) {
  return x === undefined ? '' : x;
}

async function check(title, dir, cfg, order) {
  process.stdout.write(`Checking: ${title}...`);
  dir = `${__dirname}/${dir}`;
  const ta = new TestAdapter();
  const mp = new MessagePublisher(cfg, ta, () => assert(false));

  const filenames =
    fs.readdirSync(dir).filter(f => f.startsWith('msg-')).sort();
  set_mtime_order(dir, [...filenames].reverse());

  const mktopic = s =>
    `${u2e(cfg['message-topic-prefix'])+s+u2e(cfg['message-topic-suffix'])}`;

  const promises = [];
  const items = [];
  for (const fname of filenames) {
    promises.push(mp.add(dir, fname));
    
    const lh = cfg['letterhead-file'] ?
      JSON.parse(fs.readFileSync(cfg['letterhead-file'])) : {};
    const msg = merge(lh, JSON.parse(fs.readFileSync(`${dir}/${fname}`)));
    const item = {
      topic: mktopic(msg.topic),
      payload: JSON.stringify(msg.payload),
      compress: msg.compress,
      opts: { qos: msg.qos }
    };
    items.push(item);
  }

  const expectations = order.map(v => items[v]);
  ta.setExpectations(expectations);

  setImmediate(() => ta.connect());

  return await Promise.all(promises).catch(e => {
    console.error(e);
    process.exit(1);
  }).then(() => console.log('Ok'));
}

(async () => {
  await check(
    'Default ordering, no concurrency',
    '/msg-test-1',
    {
      ['message-order']: 'lexical',
      ['message-concurrency']: 1
    },
    [ 2, 1, 0, 3, 4 ]
  );

  await check(
    'Default ordering, with concurrency',
    '/msg-test-1',
    {
      ['message-order']: 'lexical',
      ['message-concurrency']: 4
    },
    [ 2, 1, 0, 3, 4 ]
  );

  await check(
    'Reverse lexical ordering',
    '/msg-test-1',
    {
      ['message-order']: 'reverse-lexical',
    },
    [ 2, 1, 4, 3, 0 ]
  );

  await check(
    'Newest-first ordering',
    '/msg-test-1',
    {
      ['message-order']: 'newest-first',
    },
    [ 2, 1, 4, 3, 0 ]
  );

  await check(
    'Oldest-first ordering',
    '/msg-test-1',
    {
      ['message-order']: 'oldest-first',
    },
    [ 2, 1, 0, 3, 4 ]
  );

  await check(
    'Topic prefixing',
    '/msg-test-1',
    {
      ['message-topic-prefix']: 'pre|',
      ['message-topic-suffix']: '|post'
    },
    [ 2, 1, 0, 3, 4 ]
  );

  await check(
    'Static letterhead',
    '/msg-test-1',
    {
      ['letterhead-file']: `${__dirname}/msg-test-1/letterhead`,
    },
    [ 2, 1, 0, 3, 4 ]
  );
})();
