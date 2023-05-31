/* Copyright(C) 2023 DiUS Computing Pty Ltd */
'use strict';

/* new MessagePublisher(cfg, comms)
 *
 * where comms is an object which:
 *  - is an event emitter with the events 'connected' and 'disconnected'
 *  - has an async 'publish(topic, msg, opts)' function for publishing messages
 * Available cfg keys are:
 *   letterhead-file=<filename>
 *     name of JSON file to use as letterhead for each message
 *   letterhead-generator=<filename>
 *     name of binary to invoke for each message to produce the letterhead
 *   message-concurrency=<number>
 *     the number of concurrent in-flight messages (default 10)
 *   message-order=<lexical|reverse-lexical|newest-first|oldest-first>
 *     the preferred upload order of messages, for un-prioritised messages
 *   message-retries=<number>
 *     how many times to retry sending a message before giving up (default 2)
 */

const DEFAULT_RETRIES = 2;

const child_process = require('child_process');
const fs = require('fs');
const zlib = require('zlib');
const merge = require('./merge.js');
const MessageQueue = require('./message_queue.js');


function loadJson(fname) {
  return JSON.parse(fs.readFileSync(fname));
}


function fetchLetterhead(binfile, item, was_prioritised) {
  // Provide message metadata to the letterhead generator via environment
  const env = Object.assign({}, process.env);
  const keys = [ 'topic', 'timestamp', 'priority', 'priority_slot' ];
  for (const key of keys)
    env[`MESSAGE_${key.toUpperCase()}`] = item[key];
  env.MESSAGE_TIMESTAMP_S = Math.floor(item.timestamp/1000);
  env.MESSAGE_FILENAME = item.name;
  env.MESSAGE_WAS_PRIORITISED = was_prioritised ? '1' : undefined;

  const opts = {
    timeout: 5000,
    encoding: 'utf8',
    env: env,
  };
  return JSON.parse(child_process.execFileSync(binfile, opts));
}


class MessagePublisher {

  constructor(cfg, comms, jam_handler) {
    if (cfg['letterhead-file'] != null) {
      const lh = cfg['letterhead-file'];
      this._blank_letterhead = () => loadJson(lh);
    }
    else if (cfg['letterhead-generator'] != null) {
      const lh = cfg['letterhead-generator'];
      this._blank_letterhead =
        (item, was_prioritised) => fetchLetterhead(lh, item, was_prioritised);
    }
    else
      this._blank_letterhead = () => { return {}; };

    if (cfg['message-retries'] != null)
      this._max_retries = +cfg['message-retries'];
    else
      this._max_retries = DEFAULT_RETRIES;

    this._topic_pfx = cfg['message-topic-prefix'] || '';
    this._topic_sfx = cfg['message-topic-suffix'] || '';

    this._comms = comms;
    comms.on('connected', () => { this._on_connect(); } );
    comms.on('disconnected', () => { this._on_disconnect(); });

    const jam_timeout_ms = (cfg['message-jam-timeout'] != null) ?
      cfg['message-jam-timeout'] * 1000 : undefined;
    this._q = new MessageQueue({
      concurrency: cfg['message-concurrency'],
      order: cfg['message-order'],
      jam_timeout: jam_timeout_ms,
    });
    this._q.on('item',
      (item, was_prioritised) => this._on_item(item, was_prioritised));
    this._q.on('jammed', jam_handler);
    this._q.pause();
  }


  add(dir, fname) {
    try {
      const filename = `${dir}/${fname}`;
      const preview = loadJson(filename);

      // Note: priority information can NOT come from the letterhead!
      const item = {
        name: filename,
        timestamp: fs.statSync(filename).mtimeMs,
        priority_slot: preview.priority_slot,
        priority: preview.priority,
        topic: `${this._topic_pfx}${preview.topic}${this._topic_sfx}`,

        promise: {},
      };
      const p = new Promise((resolve, reject) => {
        item.promise.resolve = resolve,
        item.promise.reject = reject;
      });

      this._q.add(item);

      return p;
    }
    catch(e)
    {
      return Promise.reject(e);
    }
  }

  _on_connect() {
    this._q.resume();
  }

  _on_disconnect() {
    this._q.pause();
    // Also clear queue? Or can we rely on the mqtt.js buffering of msgs?
  }

  _on_item(item, was_prioritised) {
    const opts = {};
    var letter;
    try {
      letter = this._blank_letterhead(item, was_prioritised);
      merge(letter, loadJson(item.name));

      // Ensure the mandatory keys are present
      for (const key of [ 'topic', 'payload' ])
        if (letter[key] == null)
          throw new Error(
            `missing '${letter[key]}' in '${item.name}', unable to publish`);

      // Flatten to JSON if necessary
      if (typeof(letter.payload) == 'object')
        letter.payload = JSON.stringify(letter.payload);

      // Handle payload compression
      if (letter.compress == 'gzip')
        letter.payload = zlib.gzipSync(letter.payload);
      else if (letter.compress == 'deflate')
        letter.payload = zlib.deflateSync(letter.payload);
      else if (letter.compress !== undefined)
        console.warn(`Ignoring unsupported compression "${letter.compress}"`);

      // Copy supported options
      [ 'qos' ].forEach(k => opts[k] = letter[k]);
    }
    catch(e) {
      console.warn(`Error loading letterhead/message: ${e}`);
      item.promise.reject(e);
      return;
    }

    // Note: we've precomputed the pfx+topic+sfx as item.topic, so use it
    this._comms.publish(item.topic, letter.payload, opts)
    .then(() => {
      this._q.complete(item);
      item.promise.resolve();
    })
    .catch(e => {
      this._q.complete(item);
      item.retries = (item.retries || 0) + 1;
      if (item.retries < this._max_retries)
        this._q.add(item); // Not uploaded, try again
      else
        item.promise.reject(e);
    })
  }

}

module.exports = MessagePublisher;
