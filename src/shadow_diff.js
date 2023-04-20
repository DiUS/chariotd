/* Copyright(C) 2022-2023 DiUS Computing Pty Ltd */
const isDeepStrictEqual = require('util').isDeepStrictEqual;
const isObject = require('./is_object.js');


function filterEmpty(o) {
  if (!isObject(o))
    return o;
  else
    return (Object.keys(o).length > 0) ? o : undefined;
}


function removeDeletionRequests(o) {
  if (!isObject(o))
    return;
  Object.keys(o).forEach(k => {
    if (o[k] === null)
      delete(o[k]);
    else if (isObject(o[k]))
      removeDeletionRequests(o[k]);
  });
}


function deepMissing(oldobj, newobj, out) {
  if (newobj == null)
    return out;

  // Find keys present in newobj not present in oldobj
  return Object.keys(newobj).reduce((diff, k) => {
    const a = (oldobj || {})[k];
    const b = newobj[k];
    if (a === undefined && b !== null) {
      if (isObject(b))
        removeDeletionRequests(b);
      diff[k] = b;
    }
    else if (isObject(a) && isObject(b)) {
      const delta = deepMissing(a, b, {});
      // Only merge in non-empty deltas
      if (Object.keys(delta).length > 0) {
        if (diff[k] == null)
          diff[k] = {};
        Object.assign(diff[k], delta);
      }
    }
    return diff;
  }, out || {});
}


function recursiveDiff(oldobj, newobj) {
  // Walk keys in oldobj recursively, picking out differences
  const pass1 = Object.keys(oldobj).reduce((diff, k) => {
    const a = oldobj[k];
    const b = newobj[k];
    if (a === b)
      return diff; // no diff
    else if (Array.isArray(a) || Array.isArray(b)) {
      if (!isDeepStrictEqual(a, b))
        diff[k] = b; // whole-array diff
    }
    else if (isObject(a) && isObject(b)) {
      const delta = recursiveDiff(a, b); // recursive diff
      if (delta !== undefined && Object.keys(delta).length > 0)
        diff[k] = delta;
    }
    else if (b === undefined)
      diff[k] = null; // removal -> null translation
    else
      diff[k] = b; // value diff
    return diff;
  }, {});

  return deepMissing(oldobj, newobj, pass1);
}


/* Returns:
 *   undefined  if oldobj deepstrictequal newobj or newobj === undefined
 *   null       if newobj is null and oldobj is anything but null (deletion)
 *   newobj     if newobj is non-object type and not deepstrictqual oldobj
 *   <object>   containing recursive differences between oldobj and newobj
 */
function shadowDiff(oldobj, newobj) {
  if (oldobj != null && newobj === null) // deletion
    return null;
  else if (!isObject(oldobj) || !isObject(newobj)) // str, num, bool, array, etc
    return isDeepStrictEqual(oldobj, newobj) ? undefined : newobj;
  else
    return filterEmpty(recursiveDiff(oldobj, newobj));
}

module.exports = shadowDiff;
