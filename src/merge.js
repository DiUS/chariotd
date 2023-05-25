/* Copyright(C) 2023 DiUS Computing Pty Ltd */
'use strict';

const isObject = require('./is_object.js');

function merge(target, source) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!isObject(target[key]))
          target[key] = {}
        merge(target[key], source[key]);
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

module.exports = merge;
