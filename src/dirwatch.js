/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';

/* dirwatch(basedir, (newdir, fname) => {}, max_failed)
 *
 * Watches the new/ directory under basedir/ for files moved into it, and
 * invokes the callback when so happens. In case the callback throws an
 * error, keeps up to max_failed files around in failed/ for inspection.
 *
 * If no max_failed is given, a default of 10 is used.
 *
 * In the case where files cannot be removed, an error message is logged
 * but no other action is taken. The one foreseen circumstance where this might
 * happen is if the filesystem hits an error and gets remounted read-only.
 * Under that scenario outside intervention is required, but it is probably
 * still desirable to keep the application running even though the dirwatch
 * aspect has effectively stalled.
 */

const MAX_PRUNE_KEEP_DEFAULT = 10;

const fs = require('fs');


function maybe_rofs(fname, e) {
  console.error(
    `Failed to remove ${fname}, is the file system read-only?`, e);
}


function prune(dir, max) {
  var old = '<n/a>';
  try {
    const list = fs.readdirSync(dir);
    while (list.length > max) {
      old = `${dir}/${list.shift()}`;
      console.log(`Discarding old file: ${old}`);
      fs.unlinkSync(old);
    }
  }
  catch(e) {
    maybe_rofs(old, e);
  }
}


function DirWatch(basedir, cb, opts) {
  this._basedir = basedir;
  this._max_failed = ((opts || {}).max_failed != null) ?
    opts.max_failed : MAX_PRUNE_KEEP_DEFAULT;

  const newdir = `${this._basedir}/new`;
  const faileddir = `${this._basedir}/failed`;

  this._failed = (fname) => {
    prune(faileddir, this._max_failed);
    try {
      console.warn(`Moving failed file '${fname}' to ${faileddir}`)
      fs.renameSync(`${newdir}/${fname}`, `${faileddir}/${fname}`);
    }
    catch(e) {
      // If we get here, we might be looking at an out-of-disk scenario,
      // so the best we can do is to remove rather than keep in failed/
      console.error(
        `Unexpectedly failed to mark ${fname} as failed, removing instead!`, );
      try {
        fs.unlinkSync(`${newdir}/${fname}`);
      }
      catch(e) {
        maybe_rofs(fname, e);
      }
    }
  };

  this._handle = (fname) => {
    Promise.resolve()
    .then(() => cb(newdir, fname))
    .then(() => fs.unlinkSync(`${newdir}/${fname}`))
    .catch(e => {
      console.error(`Handling of ${newdir}/${fname} failed:`, e);
      this._failed(fname);
    });
  };

  this._watch = fs.watch(newdir, {}, (ev, fname) => {
    if (ev != 'rename' || !fs.existsSync(`${newdir}/${fname}`))
      return; // ignore non-moves, and moves _out_ of the dir
    this._handle(fname);
  });
}


DirWatch.prototype.close = function() {
  if (this._watch) {
    this._watch.close();
    this._watch = null;
  }
}


DirWatch.prototype.rescan = function() {
  fs.readdirSync(`${this._basedir}/new`)
    .sort()
    .forEach(fname => this._handle(fname));
}


module.exports = DirWatch;
