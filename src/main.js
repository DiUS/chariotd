#!/usr/bin/env node
/* Copyright(C) 2019-2023 DiUS Computing Pty Ltd */
'use strict';

const awsiot = require('aws-iot-device-sdk');
const fs = require('fs');
const child_process = require('child_process');
const EventEmitter = require('events');
const CertStore = require('./certstore.js');
const Shadow = require('./shadow.js');
const DirWatch = require('./dirwatch.js');
const FleetProvisioning = require('./fleet_provisioning.js');
const MessagePublisher = require('./message_publisher.js');
const { SecureTunnel } = require('./secure_tunnel.js');
const services = require('./services.js');
const { options } = require('./cmdline_opts.js');


// --- Helper functions --------------------------------------------------

function splitArg(x) {
  // If we ever want to support a : in the path we'll have to adjust this
  const res = x.split(':');
  if (res.length != 2)
    throw new Error(
      `Malformed argument '${x}' - expected form of 'something:something-else`);
  return res;
}


function prepareLastWill() {
  if (options['last-will-topic'] != null &&
      options['last-will-payload'] != null) {
    return {
      will: {
        topic: options['last-will-topic'],
        payload: options['last-will-payload'],
        qos: 1,
      }
    };
  }
  else
    return undefined;
}


function refetchShadows() {
  for (const key in shadows)
    shadows[key].fetch();
}


function updateShadow(thing, dir, fname) {
  const svcname = fname.split('.')[0]; // support service.timestamp
  const svc = (svcs[thing] || {})[svcname];
  const fmt = (svc || {}).informat || 'JSON';
  if (shadows[thing] != null) {
    console.log(
      `Applying shadow update to '${thing}' for service '${svcname}'.`);
    try {
      const text = fs.readFileSync(`${dir}/${fname}`, { encoding: 'utf8' });
      shadows[thing].onLocalDelta(svcname, services.parseIn(fmt, text));
    }
    catch(e) {
      console.warn(`Error applying shadow update: ${e}`);
    }
  }
  else
    console.log(`No connection available for '${thing}' yet, update to '${svcname}' delayed.`);
}


function handleCommand(dir, fname) {
  switch(fname) {
    case 'refetch':
      console.info(`Re-fetching shadows due to command request.`);
      refetchShadows();
      break;
    case 'reprovision':
      if (options.fleetprov != null) {
        console.info(`Attempting re-provisioning due to command request.`);
        attemptFleetProvisioning();
      }
      else
        console.warn(`Ignoring impossible request to reprovision - no fleet provisioning details provided on startup.`);
      break;
    case 'open-tunnel': {
      const obj = JSON.parse(fs.readFileSync(`${dir}/${fname}`));
      if (tunnels[obj.thing] != null)
        tunnels[obj.thing].launch(obj.token, obj.services, obj.region);
      else
        console.warn(
          `Ignored open-tunnel request for '${obj.thing}': not configured`);
      break;
    }
    case 'close-tunnel': {
      const obj = JSON.parse(fs.readFileSync(`${dir}/${fname}`));
      if (tunnels[obj.thing] != null)
        tunnels[obj.thing].terminate();
        else
          console.warn(
            `Ignored close-tunnel request for '${obj.thing}': not configured`);
      break;
    }
    default:
      console.warn(`Ignored unknown command '${fname}'.`);
      break;
  }
}


function delayedExit(sec) {
  setTimeout(() => process.exit(1), sec*1000);
}


function bestEffortFileWrite(fname, data) {
  const { O_NONBLOCK, O_WRONLY } = fs.constants;
  try {
    const fd = fs.openSync(fname, O_NONBLOCK | O_WRONLY);
    fs.writeSync(fd, data);
    fs.closeSync(fd);
  }
  catch(e) {
    console.warn(`Failed to write to ${fname}: ${e}`);
  }
}


function bestEffortExecWrite(fname, data) {
  const child = child_process.execFile(fname, { timeout: 5000 }, err => {
    if (err)
      console.warn(`Failed to run ${fname}: ${err}`);
  });
  if (child.stdio != null) { // On launch failure, these aren't present :(
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.stdin.end(data);
  }
}


// -- Setup phase --------------------------------------------------------

var comms = null;

const certstore =
  new CertStore(options.certstore, options.cacert, options.clientid);

const ourcerts = certstore.getCerts();
console.info(`Found ${ourcerts.available.length} certificates.`);

// Work out which things we need to register
const things = [...[ 'services', 'shadow', 'defaultshadow' ].reduce(
  (out, opt) => {
    for (const arg of (options[opt] || []))
      out.add(splitArg(arg)[0]);
    return out;
  }, new Set()).keys()
];
console.info(`Total of ${things.length} things to register.`);

// Load the service definitions and keep them by thing name
const svcs = (options.services || []).reduce((out, arg) => {
  const [ thing, dir ] = splitArg(arg);
  out[thing] = services.loadServicesDir(dir);
  console.info(
    `Total of ${Object.keys(out[thing]).length} services for thing ${thing}.`);
  return out;
}, {});

// Establish directory watches for shadow updates
const dirwatches = {}
for (const arg of (options.updates || [])) {
  const [ thing, dir ] = splitArg(arg);
  const fmt = (svcs[thing] && svcs[thing].informat) || 'JSON';
  console.info(`Establishing update watcher for '${thing}' on ${dir}`);
  dirwatches[thing] =
    new DirWatch(dir, (dir, fname) => updateShadow(thing, dir, fname));
}

// Note any initial shadow content generation commands
const default_shadow_cmds = {};
for (const arg of (options.defaultshadow || [])) {
  const [ thing, cmd ] = splitArg(arg);
  default_shadow_cmds[thing] = cmd;
  console.info(`Default shadow content generator available for ${thing}.`);
}

// Note tunnel configs, if any
const tunnels = {};
const tunnel_topics = {};
for (const arg of (options.tunnelmappings || [])) {
  const [ thing, list ] = splitArg(arg);
  const tunnel = new SecureTunnel(
    thing, list, options.tunnelproxy, options.tunnelcadir);
  tunnels[thing] = tunnel;
  tunnel_topics[tunnel.topic()] = tunnel;
  console.info(`Secure tunnel config loaded for ${thing}.`);
}

// Note delete request compatibility, if needed
if (options['empty-array-as-delete-request']) {
  require('./shadow_normalise.js').enableEmptyArrayDelete(true);
  console.info('Supporting empty array as delete request.');
}

// Note subscriptions, if any
const subscriptions = {};
for (const arg of (options['subscribe-write'] || [])) {
  const [ topic, fname ] = splitArg(arg);
  subscriptions[topic] = data => bestEffortFileWrite(fname, data);
}
for (const arg of (options['subscribe-exec'] || [])) {
  const [ topic, fname ] = splitArg(arg);
  subscriptions[topic] = data => bestEffortExecWrite(fname, data);
}

const shadows = {};

const cmdwatch = (options.commands != null) ?
  new DirWatch(options.commands, handleCommand) : null;
console.info(
  `${cmdwatch == null ? "No w" : "W"}atcher for command requests established${cmdwatch == null ? "." : " on "+options.commands}`);


// --- Comms handling ---------------------------------------------------
var comms_attempts = 0;

function checkCommsAttempts() {
  if (comms_attempts > 5) {
    console.error('Error threshold reached for connection errors/timeouts.');
    const available = ourcerts.available;
    if (available.length > 1) {
      console.info('Rotating preferred certificate for recovery purposes...');
      const next = certstore.rotateNext();
      console.info(`Set '${next.certId}' as new preferred certificate.`);
    }
    console.error('Terminating for a clean process to retry in.');
    process.exit(1);
  }
}


function connect() {
  console.info('Connecting to AWS IoT Core...');

  const keepalive = options.keepalive != null ? +options.keepalive : 1200;
  const alpn = (ourcerts.preferred.port == 443) ?
    { ALPNProtocols: [ 'x-amzn-mqtt-ca' ] } : undefined;
  const lwt = prepareLastWill();
  const comms = awsiot.thingShadow(
    Object.assign({ keepalive }, ourcerts.preferred, alpn, lwt));
  const registered = {};
  ++comms_attempts;
  comms.on('connect', () => {
    console.info('Connected.');
    for (const thing of things) {
      const withServices = svcs[thing] != null;
      shadows[thing] = new Shadow(
        comms, thing, svcs[thing], default_shadow_cmds[thing]);
      function go() {
        if (dirwatches[thing] != null)
          dirwatches[thing].rescan(); // pick up any pending changes
        shadows[thing].fetch();
      }
      // The callback to comms.register() doesn't get called if we've connected
      // once before, so only register if we haven't or we get stuck waiting.
      if (registered[thing] == null) {
        console.log(`Registering thing '${thing}'.`);
        comms.register(
          thing,
          { ignoreDeltas: !withServices },
          () => {
            console.log(`Successfully registered thing '${thing}'.`);
            registered[thing] = true;
            go();
          }
        );
      }
      else // thing is already registered, we may do updates & fetches
        go();
    }
    for (const thing in tunnels) {
      comms.subscribe(tunnels[thing].topic(), err => {
        if (err != null)
          console.warn(
            `Failed to subscribe to tunnel topic for '${thing}': ${err}`);
      });
    }
    for (const topic in subscriptions) {
      comms.subscribe(topic, err => {
        if (err != null)
          console.warn(`Failed to subscripe to ${topic}: ${err}`);
        else
          console.log(`Subscribed to ${topic}`);
      });
    }
  });
  comms.on('status', (thing, stat, token, resp) => {
    comms_attempts = 0;
    shadows[thing].onStatus(stat, token, resp);
  });
  comms.on('delta', (thing, resp) => {
    comms_attempts = 0;
    shadows[thing].onDelta(resp);
  });
  comms.on('timeout', (thing, token) => {
    shadows[thing].onTimeout(token);
    ++comms_attempts;
    checkCommsAttempts();
  });
  comms.on('message', (topic, payload) => {
    const tunnel = tunnel_topics[topic];
    const subscription_handler = subscriptions[topic];
    if (tunnel != null)
      tunnel.handleMessage(payload);
     else if (subscription_handler != null) {
       console.log(`Received message on ${topic}`);
       subscription_handler(payload);
     }
  });
  comms.on('error', err => {
    console.error(`AWS IoT Core connection reported error: ${err}`);
    checkCommsAttempts();
  });
  comms.on('close', () => console.warn('Lost connection to AWS IoT Core.'));
  comms.on('reconnect', () => {
    ++comms_attempts;
    checkCommsAttempts();
    console.info(`Reconnecting to AWS IoT Core... (attempt ${comms_attempts})`)
  });
  return comms;
}


// -- Fleet Provisioning -------------------------------------------------

function checkFleetProvisioningConfig(cfg) {
  for (const key of [ 'claimstore', 'template', 'parameters' ])
    if (cfg[key] == null)
      throw new Error(`Missing key '${key}'`);
  if (cfg.outfile != null && cfg.outformat == null)
    throw new Error(`Key 'outformat' required when 'outfile' != null`);
  if (typeof(cfg.parameters) != 'object' || Array.isArray(cfg.parameters))
    throw new Error(`'parameters' must be an object`);
}


async function attemptFleetProvisioning() {
  try {
    const cfg = JSON.parse(fs.readFileSync(options.fleetprov));
    checkFleetProvisioningConfig(cfg);
    const fp = new FleetProvisioning(
      cfg.claimstore, options.cacert, `${options.clientid}-fp`, cfg.template);
    const resp = await fp.attempt(cfg.parameters);
    console.info(`Storing new certificate ${resp.certId}.`);
    certstore.addCert(resp.certId, resp.certPem, resp.certKey);
    if (cfg.outfile) {
      const { thing, configuration } = resp;
      console.info(`Storing thing configuration data in ${cfg.outfile}.`);
      fs.writeFileSync(cfg.outfile,
        services.stringifyOut(cfg.outformat, { thing, configuration }));
    }
    else
      console.info(`Discarded unwanted thing configuration data:`, resp);
    if (cfg.notifycmd) {
      console.info(`Notifying provisioning handler.`);
      const opts = {
        cwd: '/',
        timeout: 10*1000,
        killSignal: 'SIGKILL',
      };
      child_process.execSync(cfg.notifycmd, opts);
    }
    console.info(
      `Fleet provisioning completed. Exiting for clean connection.`);
    process.exit(0);
  }
  catch(e) {
    console.error(`ERROR: Fleet provisioning failed:`, e);
    console.error(
      `Exiting in 30sec for retry (possibly with different cert)...`);
    delayedExit(30);
  }
}


// -- Message publishing -------------------------------------------------

var message_publisher = null;
var msgwatch = null;


function createMessagePublisher(comm, dir) {
  // Create and wire up our adapter to the message publisher
  const message_adapter = new EventEmitter();
  comm.on('connect', () => message_adapter.emit('connected'));
  comm.on('close', () => message_adapter.emit('disconnected'));
  message_adapter.publish = function(topic, msg, opts) {
    return new Promise((resolve, reject) => {
      comm.publish(topic, msg, { qos: opts.qos != null ? opts.qos : 1 },
        (err) => {
          if (err) {
            console.warn(`Failed to publish to ${topic}: ${err}`);
            reject(err);
          }
          else {
            console.log(`Successfully published to ${topic}.`);
            comms_attempts = 0;
            resolve();
          }
        }
      );
    });
  };
  // Work out configuration for this message publisher
  const opts = {};
  const opt_keys = [
    'message-concurrency', 'message-retries', 'message-order',
    'message-jam-timeout', 'message-topic-prefix', 'message-topic-suffix',
    'letterhead-file', 'letterhead-path'
  ];
  for (const key of opt_keys) {
    // Start with default, if set
    const def = 'default-'+key;
    if (options[def] != null)
      opts[key] = options[def];
    // Override with per-dir, if set
    for (const arg of (options[key] || [])) {
      const [ optdir, val ] = splitArg(arg);
      if (optdir == dir)
        opts[key] = val;
    }
  }
  const on_jam = () => {
    console.error(
      `Error: Message queue on ${dir} has jammed. Exiting for clean retry.`);
    process.exit(1);
  };
  return new MessagePublisher(opts, message_adapter, on_jam);
}


// -- Initial startup ----------------------------------------------------

if (prepareLastWill())
  console.info(`Found Last-Will-and-Testament settings; will register LWT.`);
else
  console.info(`No Last-Will-and-Testament settings; won't register LWT.`);

if (ourcerts.preferred == null) {
  if (options.fleetprov != null) {
    console.info(`No certificate available, attempting Fleet Provisioning...`);
    attemptFleetProvisioning();
  }
  else {
    console.error(`ERROR: No usable certificate found. Terminating in 10.`);
    // If were to just exit we'd get relaunched right away and we'd just be
    // burning CPU needlessly, as this may very well be an unrecoverable error.
    delayedExit(10);
  }
}
else {
  console.info(`Using certificate ${ourcerts.preferred.certId}.`);
  comms = connect();

  // Late setup of messages watcher, as we need comms to be available
  for (const message_dir of (options.messages || [])) {
    console.info(`Establishing messages watcher on ${message_dir}`);
    message_publisher = createMessagePublisher(comms, message_dir);
    msgwatch = new DirWatch(
      message_dir,
      (dir, fname) => message_publisher.add(dir, fname)
    );
    msgwatch.rescan();
  }

  if (cmdwatch != null)
    cmdwatch.rescan();
}


// -- Signal and exception handling ---------------------------------------

process.on('SIGHUP', () => {
  console.info('Got SIGHUP, re-fetching shadow(s)...');
  refetchShadows();
});


process.on('SIGINT', () => {
  console.info('Shutdown requested (SIGINT), exiting.');
  process.exit(0);
});


process.on('SIGTERM', () => {
  console.info('Shutdown requested (SIGTERM), exiting.');
  process.exit(0);
});


process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at', promise, 'reason', reason);
  process.exit(1);
});
