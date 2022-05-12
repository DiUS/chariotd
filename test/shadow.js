#!/usr/bin/env node
const Shadow = require('../src/shadow.js');
const Service = require('../src/services.js').Service;
const assert = require('assert').strict;

const THING = 'test';

// Helper functions

function slowClone(obj) {
  if (obj == null) // null/undefined
    return null;
  return JSON.parse(JSON.stringify(obj));
}

function storeCfg(obj, cfg) {
  obj.cfg = cfg;
  return true;
}

// Test objects

const mock_comms = {
  get: function(thing, token) {},
  update: function(thing, tok_n_state) {
    assert(thing == THING);
    assert(tok_n_state.clientToken == 'UPDATE:test');
    mock_comms.last_update_state = tok_n_state.state;
  },
};

const svc1 = new Service({ // regular service def
  key: 'svc1',
  outfile: 'svc1.rc',
  outformat: 'JSON',
  informat: 'JSON',
  notify: () => { svc1.notified = true; },
  writeOut: (cfg) => storeCfg(svc1, cfg),
  getCurrentCfg: () => slowClone(svc1.cfg),
});


const svc2 = new Service({ // ephemeral
  key: 'svc2',
  informat: 'JSON',
  ephemeraldata: true,
  notify: () => { svc2.notified = true; },
  writeOut: (cfg) => storeCfg(svc2, cfg),
  getCurrentCfg: () => slowClone(svc2.cfg),
});

const svc3 = new Service({ // cfg overrider
  key: 'svc3',
  outfile: 'svc3.rc',
  outformat: 'JSON',
  informat: 'JSON',
  notify: () => { svc3.notified = true; },
  validate: function(cfg) {
    return { value: 42 };
  },
  writeOut: (cfg) => storeCfg(svc3, cfg),
  getCurrentCfg: () => slowClone(svc3.cfg),
});

const svc4 = new Service({ // initialnotify
  key: 'svc4',
  outfile: 'svc4.rc',
  outformat: 'JSON',
  informat: 'JSON',
  initialnotify: true,
  notify: () => { svc4.notified = true; },
  writeOut: (cfg) => storeCfg(svc4, cfg),
  getCurrentCfg: () => slowClone(svc4.cfg),
});

const svc5 = new Service({ // update rejecter
  key: 'svc4',
  outfile: 'svc4.rc',
  outformat: 'JSON',
  informat: 'JSON',
  notify: () => { svc4.notified = true; },
  validate: function(cfg) { throw new Error("intentional"); },
  writeOut: (cfg) => storeCfg(svc5, cfg),
  getCurrentCfg: () => slowClone(svc5.cfg),
});

// Cleanup

function clear()
{
  [ 'cfg', 'notified' ].forEach(
    k => [ svc1, svc2, svc3, svc4, svc5 ].forEach(
      s => delete s[k]
    )
  );
  if (mock_comms.last_update_state) {
    delete(mock_comms.last_update_state);
    shadow1.onUpdateStatus('accepted', {});
  }
}

// Shadow setup

const shadow1 = new Shadow(mock_comms, THING, { svc1, svc2, svc3, svc4, svc5 });

// Validate initial processing of services/configs
shadow1.onFetchStatus('accepted', { state: {} }); // fetch pending after new
assert(!svc1.notified);
assert(!svc2.notified);
assert(svc3.notified); // due to validate override null -> { value: 42 }
assert(svc4.notified); // due to initialnotify
assert(!svc5.notified);
assert(svc1.cfg === undefined);
assert(svc2.cfg === undefined);
assert(svc3.cfg.value === 42);
assert(svc4.cfg == undefined);
assert(svc5.cfg == undefined);
clear();

// Validate general delta handling
shadow1.onDelta({
  state: {
    svc1: { hello: 1, newval: 2 },
    svc2: true,
    svc3: { value: 43, toignore: 1 },
  }
});
assert.deepEqual(mock_comms.last_update_state, {
  reported: {
    svc1: { hello: 1, newval: 2 },
    svc3: { value: 42 },
  },
  desired: null,
});
assert(svc1.notified);
assert(svc2.notified);
assert(svc3.notified);
assert(!svc4.notified);
clear();

// Validate no notify on overridden delta
svc3.cfg = svc3.validate();
shadow1.onDelta({ state: { svc3: { value: 43 }}});
assert(!svc3.notified);
assert.deepEqual(mock_comms.last_update_state, {
  reported: {},
  desired: null,
});
clear();

// Validate handling of pending desired on full shadow fetch
shadow1.fetch();
shadow1.onFetchStatus('accepted', { state: {
  desired: {
    svc1: { hello: 2 },
    svc2: true,
    svc3: { value: 41 },
    svc4: 'data',
    svc5: { x: 1 },
  }
}});
assert(svc1.notified);
assert(svc2.notified);
assert(svc3.notified);
assert(svc4.notified);
assert(!svc5.notified); // rejected the update
assert.deepEqual(svc1.cfg, { hello: 2 });
assert(svc2.cfg == null); // ephemeral
assert.deepEqual(svc3.cfg, { value: 42 });
assert(svc4.cfg == 'data');
assert(svc5.cfg == null);
clear();

// Validate delta type change
svc1.cfg = { x: 1 };
shadow1.onDelta({ state: { svc1: 'str' } });
assert(svc1.notified);
assert(svc1.cfg == 'str');
clear();

// Validate zero length string
svc1.cfg = 'str';
shadow1.onDelta({ state: { svc1: '' } });
assert(svc1.notified);
assert(svc1.cfg == '');
clear();

// Validate removal
svc1.cfg = { x: 1 };
shadow1.onDelta({ state: { svc1: 'DELETE' } });
assert(svc1.notified);
assert(svc1.cfg == null);
clear();

// Validate empty array delta (non-delete request)
svc1.cfg = [ 1, 2 ];
shadow1.onDelta({ state: { svc1: [] }});
assert(svc1.notified);
assert.deepEqual(svc1.cfg, []);
clear();

// Validate that no merge is attempted on fetch with no desired
const reported_nomerge = {
  svc1: { x: 1 },
  svc2: { y: 2 },
  svc3: { z: 3 },
  svc4: {aa: 4 },
  svc5: {ab: 5 },
};
svc1.cfg = reported_nomerge.svc1;
svc2.cfg = reported_nomerge.svc2;
svc3.cfg = reported_nomerge.svc3;
svc4.cfg = reported_nomerge.svc4;
svc5.cfg = reported_nomerge.svc5;
shadow1.fetch();
shadow1.onFetchStatus('accepted', { state: { reported: reported_nomerge }});
assert(!svc1.notified);
assert(svc2.notified); // ephemeral data always notifies
assert(svc3.notified);
assert(!svc4.notified);
assert(!svc5.notified);
assert.deepEqual(svc1.cfg, { x: 1 });
assert.deepEqual(svc2.cfg, { y: 2 }); // ephemeral data doesn't update cfg
assert.deepEqual(svc3.cfg, { value: 42 }); // validate override
assert.deepEqual(svc4.cfg, {aa: 4 });
assert.deepEqual(svc5.cfg, {ab: 5 });
clear();

// Validate no notification of ephemeraldata service in absence of data
shadow1.fetch();
shadow1.onFetchStatus('accepted', { state: { reported: {}}});
assert(!svc2.notified);
clear();
