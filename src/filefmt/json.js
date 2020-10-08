/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
// Reduced JSON handling to match shadow limits. No null values are kept during
// stringification. Most of the time the shadow has already stripped such values, but
// when a service posts an update it may well do so with a null value (to erase the
// key from the actual shadow), and when that update is applied locally we should
// obviously not write out said null value. Thus the use of the replacer function to
// JSON.stringify here.
module.exports = {
  parse: (text) => JSON.parse(text),
  stringify: (text) => JSON.stringify(text, (k, v) => (v == null) ? undefined: v),
}
