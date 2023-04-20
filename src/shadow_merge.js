/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const normalise = require('./shadow_normalise.js');
const isObject = require('./is_object.js');


function shadowMerge(target, source) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!isObject(target[key]))
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
