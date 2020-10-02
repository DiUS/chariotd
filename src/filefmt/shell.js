/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';


/* What's implemented here is a subset of shell assignment statements.
 * There any plenty of valid shell assignments that would fail to be parsed
 * by this code. That is not a concern however, as it is only intended for
 * this code to consume the output of the stringify() function here, which
 * itself is limited to producing this subset of assignment statements.
 */

function unquote(x) {
  if (typeof(x) != 'string')
    return null;
  if ((x[0] == "'" && x[x.length - 1] == "'") ||
      (x[0] == '"' && x[x.length - 1] == '"'))
    return x.substr(1, x.length - 2);
  else
    return x;
}


function shellEscape(x) {
  const y = x.toString().replace(/'/g, "\\'");
  return `'${y}'`;
}


function doStringify(obj, pfx) {
  const out = [];
  for (const key in obj) {
    const val = obj[key];
    switch(typeof(val)) {
      case 'boolean':
      case 'number':
      case 'string':
        out.push(`${pfx}${key}=${shellEscape(val)}`);
        break;
      case 'object':
        if (val == null)
          break;
        else if (Array.isArray(val))
          out.push(`${pfx}${key}=(${val.map(x => shellEscape(x)).join(' ')})`);
        else
          out.push(...doStringify(val, `${pfx}${key}_`));
        break;
      default:
        console.warn(
          `Skipping unsupported value type '${typeof(val)}' for ${key}`);
       break;
    }
  }
  return out;
}


function stringify(obj) {
  return doStringify(obj, '').sort().join('\n')+'\n';
}


// s: ('x' 'y' 'z\'z')
function parseArray(s) {
  const out = [];
  if (s.length == 2)
    return out;
  var in_quote = false;
  var start = 1;
  for (var i = 1; i < s.length; ++i) {
    if (s[i] == "'" && s[i-1] != '\\')
      in_quote = !in_quote;
    else if ((s[i] == ' ' || s[i] == ')') && !in_quote) {
      out.push(parseValue(unquote(s.substring(start, i).trim())));
      start = i + 1;
    }
  }
  return out;
}


function shellUnescape(x) {
  return x.replace(/\\'/g, "'");
}


function parseValue(quoted) {
  if (quoted == "''")
    return "";
  const val = unquote(quoted);
  if (val == '')
    return null;
  else if (val == 'true')
    return true;
  else if (val == 'false')
    return false;
  else if (val[0] == '(' && val[val.length -1] == ')')
    return parseArray(val);
  else if (!isNaN(val))
    return +val;
  else
    return shellUnescape(val);
}


function unnestAssign(out, key, val) {
  const parts = key.split('_');
  while (parts.length > 1) {
    const subkey = parts.shift();
    if (out[subkey] == null)
      out[subkey] = {};
    out = out[subkey];
  }
  key = parts.shift();
  out[key] = parseValue(val);
}


function parse(text) {
  return (text || '').split('\n').reduce((out, line) => {
    if (line == '')
      return out;
    const m = line.match(/([^=]+)=(.*)/);
    if (m != null)
      unnestAssign(out, m[1], m[2]);
    else
      console.warn(`Skipping malformed line '${line}'`);
    return out;
  }, {});
}


module.exports = { stringify, parse };
