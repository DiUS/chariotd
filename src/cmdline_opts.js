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
 [ '', 'messages=DIR+',
   'watch for message to publish to mqtt in DIR' ],
 [ '', 'commands=DIR',
   'watch for command requests in DIR' ],

 [ '', 'default-message-concurrency=N',
   'the number of concurrent message uploads (default 10)' ],
 [ '', 'message-concurrency=DIR:N+',
   'the number of concurrent message uploads (default 10)' ],
 [ '', 'default-message-retries=N',
   'how many times to re-attempt to publish a message (default 2)' ],
 [ '', 'message-retries=DIR:N+',
   'how many times to re-attempt to publish a message (default 2)' ],
 [ '', 'default-message-keep-failed=N',
   'number of failed messages to keep in the failed/ directory (default 100)' ],
 [ '', 'message-keep-failed=DIR:N+',
   'number of failed messages to keep in the failed/ directory (default 100)' ],
 [ '', 'default-message-order=ORDER',
   'preferred upload order of messages, for un-prioritised messages; one of "lexical", "reverse-lexical", "newest-first", "oldest-first" (default "lexical")' ],
 [ '', 'message-order=DIR:ORDER+',
   'preferred upload order of messages, for un-prioritised messages; one of "lexical", "reverse-lexical", "newest-first", "oldest-first" (default "lexical")' ],
 [ '', 'default-message-jam-timeout=SEC',
   'how many seconds to wait for for a concurrency slot to become available on before declaring the queue jammed (default 300)' ],
 [ '', 'message-jam-timeout=DIR:SEC+',
   'how many seconds to wait for for a concurrency slot to become available on before declaring the queue jammed (default 300)' ],
 [ '', 'default-message-topic-prefix=PREFIX',
   'prepend PREFIX to the topic of each uploaded message' ],
 [ '', 'message-topic-prefix=DIR:PREFIX+',
   'prepend PREFIX to the topic of each uploaded message' ],
 [ '', 'default-message-topic-suffix=SUFFIX',
   'append SUFFIX to the topic of each uploaded message' ],
 [ '', 'message-topic-suffix=DIR:SUFFIX+',
   'append SUFFIX to the topic of each uploaded message' ],
 [ '', 'default-letterhead-file=PATH',
   'source message letterhead from JSON file at PATH for each message' ],
 [ '', 'letterhead-file=DIR:PATH+',
   'source message letterhead from JSON file at PATH for each message' ],
 [ '', 'default-letterhead-generator=PATH',
   'source message letterhead by invoking the binary at PATH' ],
 [ '', 'letterhead-generator=DIR:PATH+',
   'source message letterhead by invoking the binary at PATH' ],

 [ '', 'tunnelmappings=THING:PORTMAPPINGS+',
   'accept tunnel requests for THING, using PORTMAPPINGS e.g. SSH=22,HTTP=80' ],
 [ '', 'tunnelproxy=PATH',
   'use PATH as tunnel proxy binary (default "localproxy")' ],
 [ '', 'tunnelcadir=DIR',
   'tell tunnel proxy to look for OpenSSL-compatibly named CA cert in DIR' ],

 [ '', 'keepalive=SECONDS',
   'send keep-alive ping every SECONDS (default 1200)' ],

 [ '', 'empty-array-as-delete-request',
   'support treating an empty array the same as DELETE to indicate a removal request' ],

 [ '', 'last-will-topic=TOPIC',
   'send last-will-and-testament payload (if any) to TOPIC' ],
 [ '', 'last-will-payload=PAYLOAD',
   'register PAYLOAD as the last-will-and-testament' ],

 [ '', 'subscribe-write=TOPIC:PATH+',
   'subscribe to TOPIC, and write any received messages to PATH' ],
 [ '', 'subscribe-exec=TOPIC:PATH+',
   'subscribe to TOPIC, and invoke PATH for each message, passing it on stdin' ],

 [ 'h', 'help', 'this help' ]
]).bindHelp().parseSystem();

const mandatory = [ 'clientid', 'cacert', 'certstore' ];
for (const opt of mandatory)
  if (cmdline.options[opt] == null) {
    console.error(`Missing mandatory option --${opt} - unable to continue.`);
    process.exit(1);
  }

module.exports = cmdline;
