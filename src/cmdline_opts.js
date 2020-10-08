/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';
const Getopt = require('node-getopt');
const cmdline = Getopt.create([
 [ '', 'clientid=CID',
   'client ID to register with AWS IoT Core as (mandatory)' ],
 [ '', 'cacert=PATH',
   'path to the root CA certificate (mandatory)' ],
 [ '', 'certstore=DIR',
   'base directory where device certificates are kept (mandatory)' ],
 [ '', 'fleetprov=CONFIGPATH',
   'enable Fleet Provisioning with configuration read from CONFIGPATH' ],
 [ '', 'services=THING:DIR+',
   'use service definitions in DIR for THING' ],
 [ '', 'updates=THING:DIR+',
   'watch for shadow updates to THING in DIR' ],
 [ '', 'messages=DIR',
   'watch for message to publish to mqtt in DIR' ],
 [ '', 'commands=DIR',
   'watch for command requests in DIR' ],
 [ 'h', 'help', 'this help' ]
]).bindHelp().parseSystem();

const mandatory = [ 'clientid', 'cacert', 'certstore' ];
for (const opt of mandatory)
  if (cmdline.options[opt] == null) {
    console.error(`Missing mandatory option --${opt} - unable to continue.`);
    process.exit(1);
  }

module.exports = cmdline;
