/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const merge = require('./merge.js');
const normalise = require('./shadow_normalise.js');

function shadowMergeAndNormalise(target, source)
{
  return normalise(merge(target, source));
}

module.exports = shadowMergeAndNormalise;
