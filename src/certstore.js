/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';

const fs = require('fs');

const utf8 = { encoding: 'utf8' };

function CertStore(basedir, caPath, clientId) {
  this._basedir = basedir;
  this._pref = `${basedir}/preferred`;
  this._caPath = caPath;
  this._clientId = clientId;
}


CertStore.prototype.setPreferred = function(certId) {
  try { fs.unlinkSync(this._pref); } catch(e) {} // remove old, if any
  fs.symlinkSync(certId, this._pref);
}


CertStore.prototype.rotatePreferred = function() {
  if (this._cache == null)
    this.getCerts();
  const available = this._cache.available;
  const pref = this._cache.preferred
  if (available.length > 1) {
    const next = [ ...available, available[0] ].reduce((found, cert) => {
      if (found)
        return (found === true) ? cert : found;
      else
        return pref.certId == cert.certId;
    }, false);
    this.setPreferred(next.certId);
    return next;
  }
  else
    return pref;
}


// returns [ { certId:, certPath:, caPath:, host:, clientId: }, ... ]
CertStore.prototype.getCerts = function() {
  const endpoint =
    fs.readFileSync(`${this._basedir}/endpoint.txt`, utf8).trim();
  // Get ordered list of subdirs, most recent first
  const dirs = fs.readdirSync(this._basedir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => {
      const st = fs.lstatSync(`${this._basedir}/${dirent.name}`);
      return {
        name: dirent.name,
        mtime: st.mtimeMs,
      }
    })
   .sort((a, b) => a.mtime > b.mtime)
   .map(x => ({
     certId:   x.name,
     certPath: `${this._basedir}/${x.name}/${x.name}-certificate.pem.crt`,
     keyPath:  `${this._basedir}/${x.name}/${x.name}-private.pem.key`,
     host:     endpoint,
     caPath:   this._caPath,
     clientId: this._clientId,
   }));

  var pref = null;
  try {
    const p = fs.readlinkSync(this._pref);
    pref = dirs.reduce((out, e) => (e.certId == p) ? e : out, null);
  }
  catch(e) {} // no preferred symlink yet

  if (pref == null && dirs.length > 0) {
    this.setPreferred(dirs[0].certId);
    pref = dirs[0];
  }
  this._cache = {
    available: dirs,
    preferred: pref,
  };
  return this._cache;
}


CertStore.prototype.addCert = function(certId, certificatePem, privateKey) {
  const dir = `${this._basedir}/${certId}`;
  const cfile = `${dir}/${certId}-certificate.pem.crt`;
  const kfile = `${dir}/${certId}-private.pem.key`;
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(cfile, certificatePem);
    fs.writeFileSync(kfile, privateKey);
  }
  catch(e) {
    console.error(
      `Failed to store certificate ${certId} in ${this._basedir}:`, e);
    // Best effort cleanup...
    try {
      fs.unlinkSync(kfile);
      fs.unlinkSync(cfile);
      fs.rmdirSync(dir);
    } catch(e) {}
  }
}



module.exports = CertStore;
