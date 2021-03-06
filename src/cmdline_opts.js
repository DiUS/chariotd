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
 [ '', 'defaultshadow=THING:COMMAND+',
   'use the output from COMMAND to seed the shadow for THING, if not already present' ],
 [ '', 'messages=DIR',
   'watch for message to publish to mqtt in DIR' ],
 [ '', 'commands=DIR',
   'watch for command requests in DIR' ],

 [ '', 'tunnelmappings=THING:PORTMAPPINGS+',
   'accept tunnel requests for THING, using PORTMAPPINGS e.g. SSH=22,HTTP=80' ],
 [ '', 'tunnelproxy=PATH',
   'use PATH as tunnel proxy binary (default "localproxy")' ],
 [ '', 'tunnelcadir=DIR',
   'tell tunnel proxy to look for OpenSSL-compatibly named CA cert in DIR' ],

 [ '', 'keepalive=SECONDS',
   'send keep-alive ping every SECONDS (default 1200)' ],

 [ 'h', 'help', 'this help' ]
]).bindHelp().parseSystem();

const mandatory = [ 'clientid', 'cacert', 'certstore' ];
for (const opt of mandatory)
  if (cmdline.options[opt] == null) {
    console.error(`Missing mandatory option --${opt} - unable to continue.`);
    process.exit(1);
  }

module.exports = cmdline;
