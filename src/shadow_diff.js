/* Copyright(C) 2022 DiUS Computing Pty Ltd */
const isDeepStrictEqual = require('util').isDeepStrictEqual;

function isObject(x) {
  return typeof(x) == 'object' && !Array.isArray(x);
}


function deepMissing(oldobj, newobj, out) {
  if (newobj == null)
    return out;

  // Find keys present in newobj not present in oldobj
  return Object.keys(newobj).reduce((diff, k) => {
    const a = (oldobj || {})[k];
    const b = newobj[k];
    if (a === undefined)
      diff[k] = b;
    else if (typeof(a) == 'object' && typeof(b) == 'object' &&
            !Array.isArray(a)) {
      const delta = deepMissing(a, b, {});
      if (Object.keys(delta).length > 0)
        Object.assign(diff[k], delta);
    }
    return diff;
  }, out || {});
}


function shadowDiff(oldobj, newobj, out) {
  if (out == null) // null/undefined
    out = {};
  if (oldobj == null && newobj == null)
    return out;
  else if (!isObject(oldobj) || !isObject(newobj))
    return newobj;
  else if (oldobj == null || newobj == null)
    return deepMissing(oldobj, newobj, out);

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
      const delta = shadowDiff(a, b, {}); // recursive diff
      if (Object.keys(delta).length > 0)
        diff[k] = delta;
    }
    else if (b === undefined)
      diff[k] = null; // removal -> null translation
    else
      diff[k] = b; // value diff
    return diff;
  }, out || {});

  return deepMissing(oldobj, newobj, pass1);
}


module.exports = shadowDiff;
