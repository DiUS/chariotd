/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const shadowNormalise = require('./shadow_normalise.js');
const shadowDiff = require('./shadow_diff.js');
const isObject = require('./is_object.js');
const fs = require('fs');
const child_process = require('child_process');
const formats = fs.readdirSync(`${__dirname}/filefmt`)
  .filter(fname => fname.endsWith('.js'))
  .reduce((obj, fname) => {
    const name = fname.replace('.js', '').toUpperCase();
    obj[name] = require(`./filefmt/${fname}`);
    return obj;
  }, {});

console.info(`Registered file formats: ${Object.keys(formats).join(', ')}`);

const DEFAULT_TIMEOUT = 10;

function loadService(dir, fname) {
  const obj = require(`${dir}/${fname}`);
  const expected = [ 'key', 'notifycmd' ];
  const unless_ephemeral = [ 'outfile', 'outformat' ];
  const optional = [
    'informat', 'outkeys', 'notifykeys', 'initialnotify',
    'validate', 'ephemeraldata', 'timeout',
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
    if (obj[key] != null && known_formats.indexOf(obj[key]) < 0) {
      console.warn(`Skipped service definition in ${dir}/${fname} due to unknown format '${obj[key]}' in ${key}`);
      return null;
    }
  }
  if (obj.timeout == null || +obj.timeout < 1)
    obj.timeout = DEFAULT_TIMEOUT;
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
    return undefined;
  }
}


function shouldNotify(picked, current, keylist) {
  if (keylist == null || !isObject(picked) || !isObject(current))
    return (shadowDiff(current, picked) !== undefined);
  else {
    const p = {};
    const c = {};
    for (const key of keylist)
    {
      // The shadowDiff does not accept key:undefined, so being careful here
      if (picked[key] !== undefined)
        p[key] = picked[key];
      if (current[key] !== undefined)
        c[key] = current[key];
    }
    return (shadowDiff(c, p) !== undefined);
  }
}


function Service(svcdef) {
  Object.assign(this, svcdef);
  this._initial = true;
}


Service.prototype.notify = function() {
  console.info(`Notifying service '${this.key}'.`);
  const opts = {
    cwd: '/',
    timeout: this.timeout*1000,
    killSignal: 'SIGKILL',
  };
  child_process.exec(this.notifycmd, opts, (err, stdout, stderr) => {
    if (err)
      console.error(`Error: Service '${this.key}' notification failed:`, err);
    if (stderr)
      console.warn(`Service '${this.key}' notified, but it said:`, stderr);
  });
}


Service.prototype.writeOut = function(obj) {
  if (this.ephemeraldata || this.outfile == null)
    return true;
  try {
    const picked = pick(obj, this.outkeys);
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
    if (obj != null && (!initial || this.initialnotify))
      this.notify();
    return;
  }
  const picked = pick(obj, this.outkeys);
  const current = this.getCurrentCfg();
  if (shadowDiff(current, picked) === undefined) {
    console.log(`No changes for service '${this.key}'.`);
    if (!initial || !this.initialnotify)
      return; // no changes, no notifications
  }
  else if (this.outfile != '/dev/null') {
    if (!this.writeOut(picked))
      return;
  }

  if ((initial && this.initialnotify) ||
      shouldNotify(picked, current, this.notifykeys))
    this.notify();
  else
    console.log(`No notification needed for '${this.key}.`);
}


Service.prototype.getCurrentCfg = function() {
  return shadowNormalise(loadCurrentOutfile(this));
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
