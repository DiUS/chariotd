/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';

const shadowMerge = require('./shadow_merge.js');


function Shadow(comms, thingName, svcs) {
  this._comms = comms;
  this._thing = thingName;
  this._svcs = svcs;
  this._tokFetch = `FETCH:${thingName}`;
  this._tokUpdate = `UPDATE:${thingName}`;
  this._pending_updates = [];
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
    const desired = resp.state.desired || {};
    const merged = shadowMerge(resp.state.reported || {}, desired);
    const upd = {};
    for (const key in merged) {
      if (this._svcs[key] != null)
        this._svcs[key].handleOut(merged[key]);
      if (desired[key] != null)
        upd[key] = shadowMerge({}, desired[key]);
    }
    if (Object.keys(upd).length > 0)
      this.update({ reported: upd, desired: null });
  }
  else if (resp.code == 404) {
    console.warn(`No shadow for '${this._thing}' yet, creating blank shadow.`);
    // Wipe any cached settings from a previous shadow
    for (const key in this._svcs)
      this._svcs[key].handleOut({});
    this.update({});
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
      svc.handleDeltaOut(delta[key]);
    upd[key] = shadowMerge({}, delta[key]); // apply delete requests
  }
  this.update({ reported: upd, desired: null });
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
