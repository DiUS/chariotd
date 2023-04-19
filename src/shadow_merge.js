/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const normalise = require('./shadow_normalise.js');


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
      else
        target[key] = source[key];
    }
  }
  else if (source === undefined) // no-merge
    return target;
  else // top-level value
    target = source;

  return target;
}


function shadowMergeAndNormalise(target, source)
{
  return normalise(shadowMerge(target, source));
}

module.exports = shadowMergeAndNormalise;
