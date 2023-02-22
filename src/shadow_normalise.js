/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

// Magic value to request key deletion in a device shadow, as AWS does not
// support delete requests in "desired" natively.
const DELETE = 'DELETE';

// Optional support for [] (empty array) as the delete request value.
let supportEmptyArrayAsDelete = false;


function isDeleteRequest(val) {
  if (supportEmptyArrayAsDelete && Array.isArray(val) && val.length == 0)
      return true;

  return val === DELETE;
}

// Process delete requests into null values
function normalise(val) {
  if (val == null || isDeleteRequest(val))
    return null;
  else if (typeof(val) == 'object') {
    for (const key in val) {
      val[key] = normalise(val[key]);
    }
  }
  return val;
}


normalise.enableEmptyArrayDelete = function(flag) {
  supportEmptyArrayAsDelete = !!flag;
}

module.exports = normalise;
