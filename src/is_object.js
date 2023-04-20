/* Copyright(C) 2023 DiUS Computing Pty Ltd */

function isObject(x) {
  return typeof(x) == 'object' && !Array.isArray(x) && (x != null);
}

module.exports = isObject;
