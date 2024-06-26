/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const child_process = require('child_process');
const shadowMerge = require('./shadow_merge.js');
const shadowDiff = require('./shadow_diff.js');
const shadowNormalise = require('./shadow_normalise.js');


function sourceInitialShadowContent(thing, cmd) {
  try {
    const cmd_opts = {
      input: thing, // allow it to read the thing name from stdin
      encoding: 'utf8',
      timeout: 5*1000,
      killSignal: 'SIGKILL',
    };
    console.log(`Sourcing initial shadow content for '${thing}' via '${cmd}'...`);
    return shadowNormalise(JSON.parse(child_process.execSync(cmd, cmd_opts)));
  }
  catch(e) {
    console.warn(`Failed to source initial shadow content via '${cmd}': ${e}`);
    return {}; // default to blank
  }
}


function validateServiceCfg(svc, cfg) {
  if (svc == null) {
    return {
      valid: false,
      cfg: null,
    }
  }

  let ok = true;
  try { cfg = shadowNormalise(svc.validate(cfg)); }
  catch(e)
  {
    console.warn(`Validation of ${svc.key} failed: ${e}`);
    ok = false;
  }

  return {
    ok: ok,
    cfg: cfg,
  }
}


function processServiceCfg(svc, cfgOld, cfgDelta, onCfgDiff) {
  const merged = shadowMerge(svc.getCurrentCfg(), cfgDelta);
  const validated = validateServiceCfg(svc, merged);
  if (validated.ok) {
    svc.handleOut(validated.cfg);
    const diff = shadowDiff(cfgOld, validated.cfg);
    if (!svc.ephemeraldata && diff !== undefined)
      onCfgDiff(diff);
  }
}


function processOldReportedCfg(svc, cfgOld, onCfgDiff) {
  const diff = shadowDiff(cfgOld, svc.getCurrentCfg());
  if (!svc.ephemeraldata && diff !== undefined) {
    console.log(`Reported values for ${svc.key} outdated, updating.`);
    onCfgDiff(diff);
  }
}


function Shadow(comms, thingName, svcs, default_cmd) {
  this._comms = comms;
  this._thing = thingName;
  this._svcs = svcs;
  this._default_cmd = default_cmd;
  this._tokFetch = `FETCH:${thingName}`;
  this._tokUpdate = `UPDATE:${thingName}`;
  this._pending_updates = [];
  this._ready = false;
}


Shadow.prototype.fetch = function() {
  if (this._svcs == null)
    return;
  this._comms.get(this._thing, this._tokFetch);
}


Shadow.prototype.update = function(obj) {
  const pending = this._pending_updates;
  if (obj != null) {
    switch(pending.length) {
      case 0: pending.push(obj); break; // normal idle case
      case 1: pending.push(obj); return; // busy, so only queue it
      case 2: // busy and already pending, so merge in new stuff
        pending[1] = shadowMerge(pending[1], obj);
        return;
      default: return; // impossible
    }
  }
  if (!this._ready)
    return; // haven't done our initial fetch yet, so just buffer updates
  if (pending.length == 0)
    return; // surplus update request, nothing needs doing
  this._comms.update(this._thing, {
    clientToken: this._tokUpdate,
    state: pending[0]
  });
}


Shadow.prototype.onStatus = function(stat, token, resp) {
  if (token == this._tokFetch)
    this.onFetchStatus(stat, resp);
  else if (token == this._tokUpdate)
    this.onUpdateStatus(stat, resp);
  else
    console.warn(`Ignoring unexpected status '${stat}' with token '${token}'`);
}


Shadow.prototype.onFetchStatus = function(stat, resp) {
  if (stat == 'accepted') {
    console.log(`Received shadow for '${this._thing}'.`);
    clearTimeout(this._fetchTimer); // may be null
    this._fetchTimer = null;
    this._ready = true;
    const reported = resp.state.reported || {};
    const desired = resp.state.desired || {};
    const upd = {};
    for (const key in this._svcs) {
      const svc = this._svcs[key];
      if (svc != null) {
        const ondiff = (diff) => { upd[key] = diff; }
        processOldReportedCfg(svc, reported[key], ondiff);
        processServiceCfg(svc, svc.getCurrentCfg(), desired[key], ondiff);
      }
    }
    if (Object.keys(upd).length > 0)
      this.update({ reported: upd, desired: null });
    else
      this.update(); // kick off any pending update(s)
  }
  else if (resp.code == 404) {
    console.warn(`No shadow for '${this._thing}' yet.`);
    const initial = this._default_cmd != null ?
      sourceInitialShadowContent(this._thing, this._default_cmd)  : {};
    console.warn(`Creating shadow with ${Object.keys(initial).length} top-level keys.`);
    // Wipe any cached settings from a previous shadow
    for (const key in this._svcs) {
      const svc = this._svcs[key];
      // Validate and handle, updating the initial shadow as needed
      const validated = validateServiceCfg(svc, initial[key]);
      if (validated.ok) {
        svc.handleOut(validated.cfg);
        initial[key] = validated.cfg;
      }
    }
    // Bypass any buffered updates so we can get the shadow created first.
    this._comms.update(this._thing, {
      clientToken: this._tokUpdate,
      state: { reported: initial }
    });
  }
  else {
    if (this._fetchTimer != null)
      console.warn(
        `Failed to fetch shadow for '${this._thing}', retry already pending.`);
    else {
      console.warn(
        `Failed to fetch shadow for '${this._thing}', scheduling retry.`);
      this._fetchTimer = setTimeout(() => {
        this._fetchTimer = null;
        this.fetch();
      }, 5 * 1000);
    }
  }
}


Shadow.prototype.onUpdateStatus = function(stat, resp) {
  if (stat == 'accepted') {
    console.log(`Shadow for '${this._thing}' updated.`);
    this._ready = true;
    this._pending_updates.shift();
    if (this._pending_updates.length > 0)
      this.update();
  }
  else {
    console.warn(
      `Shadow update failed for '${this._thing}', scheduling retry.`, resp);
    setTimeout(() => this.update(), 3 * 1000);
  }
}


Shadow.prototype.onDelta = function(resp) {
  const delta = resp.state;
  if (this._svcs == null || delta == null)
    return;
  console.log(`Received delta for '${this._thing}'.`);
  const upd = {};
  for (const key in delta) {
    const svc = this._svcs[key];
    if (svc != null)
      processServiceCfg(svc, svc.getCurrentCfg(), delta[key], (diff) => {
        upd[key] = diff;
      });
  }
  this.update({ reported: upd, desired: null });
}


Shadow.prototype.onLocalDelta = function(svcname, svcdelta) {
  if (this._svcs == null || svcdelta == null)
    return;
  const svc = this._svcs[svcname];
  if (svc != null) {
    processServiceCfg(svc, svc.getCurrentCfg(), svcdelta, (diff) => {
      const upd = { [svcname]: diff };
      this.update({ reported: upd });
    });
  }
}


Shadow.prototype.onTimeout = function(token) {
  if (token == this._tokFetch) {
    console.warn(`Timed out fetching shadow for '${this._thing}', retrying...`);
    this.fetch();
  }
  else if (token == this._tokUpdate) {
    console.warn(`Timed out updating shadow for '${this._thing}', retrying...`);
    this.update();
  }
}


module.exports = Shadow;
