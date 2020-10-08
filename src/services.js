/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';

const fs = require('fs');
const child_process = require('child_process');
const isDeepStrictEqual = require('util').isDeepStrictEqual;
const shadowMerge = require('./shadow_merge.js');
const formats = {
  SHELL: require('./filefmt/shell.js'),
  JSON:  require('./filefmt/json.js'),
}

function loadService(dir, fname) {
  const obj = require(`${dir}/${fname}`);
  const expected = [ 'key', 'outfile', 'outformat', 'informat', 'notifycmd' ];
  const optional = [ 'outkeys', 'notifykeys', 'initialnotify' ];
  for (const key of expected) {
    if (!obj.hasOwnProperty(key)) {
      console.warn(`Skipped service definition in ${dir}/${fname} due to missing key ${key}`);
      return null;
    }
  }
  const known_formats = Object.keys(formats);
  for (const key of [ 'outformat', 'informat' ]) {
    if (known_formats.indexOf(obj[key]) < 0) {
      console.warn(`Skipped service definition in ${dir}/${fname} due to unknown format '${obj[key]}' in ${key}`);
      return null;
    }
  }
  console.info(`Service '${obj.key}' loaded from ${dir}/${fname}`);
  return obj;
}


function loadServicesDir(dir) {
  return fs.readdirSync(dir)
    .filter(fname => fname.match(/.js$/))
    .map(fname => loadService(dir, fname))
    .filter(svcdef => svcdef != null)
    .reduce((out, svcdef) => {
      out[svcdef.key] = new Service(svcdef);
      return out;
    }, {});
}


function parseIn(fmt, text) {
  return formats[fmt].parse(text);
}


function stringifyOut(fmt, obj) {
  return formats[fmt].stringify(obj);
}


function pick(obj, keylist) {
  if (keylist == null)
    return Object.assign({}, obj);
  return keylist.reduce((out, key) => {
    out[key] = obj[key];
    return out;
  }, {});
}


function loadCurrentOutfile(svcdef) {
  try {
    const text = fs.readFileSync(svcdef.outfile, { encoding: 'utf8' });
    return parseIn(svcdef.informat, text);
  }
  catch(e) {
    return null;
  }
}


function shouldNotify(picked, current, keylist) {
  if (keylist == null)
    return true;
  for (const key of keylist)
    if (!isDeepStrictEqual(picked[key], current[key]))
      return true;
  return false;
}


function Service(svcdef) {
  Object.assign(this, svcdef);
  this._initial = true;
}


Service.prototype.notify = function() {
  console.info(`Notifying service '${this.key}'.`);
  const opts = {
    cwd: '/',
    timeout: 10*1000,
    killSignal: 'SIGKILL',
  };
  child_process.exec(this.notifycmd, opts, (err, stdout, stderr) => {
    if (err)
      console.error(`Error: Service '${this.key}' notification failed:`, err);
    if (stderr)
      console.warn(`Service '${this.key}' notified, but it said:`, stderr);
  });
}


Service.prototype.handleOut = function(obj) {
  const initial = this._initial;
  this._initial = false;
  const picked = pick(obj, this.outkeys);
  const current = loadCurrentOutfile(this);
  if (isDeepStrictEqual(picked, current)) {
    console.log(`No changes for service '${this.key}'.`);
    if (!initial || !this.initialnotify)
      return; // no changes, no notifications
  }
  else if (this.outfile != '/dev/null') {
    console.info(`Writing updated outfile for '${this.key}'.`);
    try {
      const tmpfile = `${this.outfile}.tmp`;
      fs.writeFileSync(tmpfile, formats[this.outformat].stringify(picked));
      fs.renameSync(tmpfile, this.outfile);
    }
    catch(e) {
      console.error(`Error: Failed to update outfile for '${this.key}':`, e);
      return;
    }
  }

  if (initial || shouldNotify(picked, current, this.notifykeys))
    this.notify();
}


Service.prototype.handleDeltaOut = function(obj) {
  const current = loadCurrentOutfile(this);
  this.handleOut(shadowMerge(current || {}, obj));
}


module.exports = {
  loadServicesDir,
  parseIn,
  stringifyOut,
}
