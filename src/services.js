/* Copyright(C) 2019-2022 DiUS Computing Pty Ltd */
'use strict';

const fs = require('fs');
const child_process = require('child_process');
const isDeepStrictEqual = require('util').isDeepStrictEqual;
const formats = {
  SHELL: require('./filefmt/shell.js'),
  JSON:  require('./filefmt/json.js'),
}

function loadService(dir, fname) {
  const obj = require(`${dir}/${fname}`);
  const expected = [ 'key', 'informat', 'notifycmd' ];
  const unless_ephemeral = [ 'outfile', 'outformat' ];
  const optional = [
    'outkeys', 'notifykeys', 'initialnotify', 'validate', 'ephemeraldata'
  ];
  const needed =
    [ ...expected, ...(obj.ephemeraldata ? [] : unless_ephemeral) ];
  for (const key of needed) {
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
  if (obj == null)
    return obj; // null or undefined
  else if (typeof(obj) != 'object' || Array.isArray(obj))
    return obj; // can't pick keys from anything other than plain object
  if (keylist == null)
    return Object.assign({}, obj);
  return keylist.reduce((out, key) => {
    if (obj[key] !== undefined)
      out[key] = obj[key];
    return out;
  }, {});
}


function loadCurrentOutfile(svcdef) {
  try {
    const text = fs.readFileSync(svcdef.outfile, { encoding: 'utf8' });
    return parseIn(svcdef.outformat, text);
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


Service.prototype.writeOut = function(picked) {
  console.info(`Writing updated outfile for '${this.key}'.`);
  try {
    const tmpfile = `${this.outfile}.tmp`;
    fs.writeFileSync(tmpfile, formats[this.outformat].stringify(picked));
    fs.renameSync(tmpfile, this.outfile);
    return true;
  }
  catch(e) {
    console.error(`Error: Failed to update outfile for '${this.key}':`, e);
    return false;
  }
}


Service.prototype.handleOut = function(obj) {
  const initial = this._initial;
  this._initial = false;
  if (this.ephemeraldata) {
    if (!initial || this.initialnotify)
      this.notify();
    return;
  }
  const picked = pick(obj, this.outkeys);
  const current = this.getCurrentCfg();
  if (isDeepStrictEqual(picked, current)) {
    console.log(`No changes for service '${this.key}'.`);
    if (!initial || !this.initialnotify)
      return; // no changes, no notifications
  }
  else if (this.outfile != '/dev/null') {
    if (!this.writeOut(picked))
      return;
  }

  if (initial || shouldNotify(picked, current, this.notifykeys))
    this.notify();
}


Service.prototype.getCurrentCfg = function() {
  return loadCurrentOutfile(this);
}

Service.prototype.validate = function(cfg) {
  return cfg;
}


module.exports = {
  Service, // for testing
  loadServicesDir,
  parseIn,
  stringifyOut,
}
