/* Copyright(C) 2019-2022 DiUS Computing Pty Ltd */
'use strict';

// Magic value to request key deletion in a device shadow, as AWS does not
// support delete requests in "desired" natively.
const DELETE = 'DELETE';


function isObjectObject(x) {
  return x != null && typeof(x) == 'object' && !Array.isArray(x);
}


function shadowMerge(target, source) {
  if (isObjectObject(target) && isObjectObject(source)) {
    for (const key in source) {
      if (isObjectObject(source[key])) {
        if (!isObjectObject(target[key]))
          target[key] = {}
        shadowMerge(target[key], source[key]);
      }
      else if (typeof(source[key]) == 'string' && source[key] == DELETE)
        target[key] = null;
      else
        target[key] = source[key];
    }
  }
  else if (target == null)
    target = source;
  return target || null; // undefined -> null
}


module.exports = shadowMerge;
