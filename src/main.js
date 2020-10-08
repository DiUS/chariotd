#!/usr/bin/env node
/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';

const awsiot = require('aws-iot-device-sdk');
const fs = require('fs');
const child_process = require('child_process');
const CertStore = require('./certstore.js');
const Shadow = require('./shadow.js');
const DirWatch = require('./dirwatch.js');
const FleetProvisioning = require('./fleet_provisioning.js');
const services = require('./services.js');
const { options } = require('./cmdline_opts.js');
const shadowMerge = require('./shadow_merge.js');


// --- Helper functions --------------------------------------------------

function splitArg(x) {
  // If we ever want to support a : in the path we'll have to adjust this
  const res = x.split(':');
  if (res.length != 2)
    throw new Error(
      `Malformed argument '${x}' - expected form of 'something:/path`);
  return res;
}


function updateShadow(thing, dir, fname) {
  const svcname = fname.split('.')[0]; // support service.timestamp
  const svc = (svcs[thing] || {})[svcname];
  const fmt = (svc || {}).informat || 'JSON';
  if (shadows[thing] != null) {
    console.log(
      `Applying shadow update to '${thing}' for service '${svcname}'.`);
    const text = fs.readFileSync(`${dir}/${fname}`, { encoding: 'utf8' });
    const upd = services.parseIn(fmt, text);
    shadows[thing].update(shadowMerge({}, { reported: { [svcname]: upd }}));
    if (svc != null)
      svc.handleDeltaOut(upd);
  }
  else
    console.log(`No connection available for '${thing}' yet, update to '${svcname}' delayed.`);
}


function delayedExit(sec) {
  setTimeout(() => process.exit(1), sec*1000);
}

// -- Setup phase --------------------------------------------------------

const certstore =
  new CertStore(options.certstore, options.cacert, options.clientid);

const ourcerts = certstore.getCerts();
console.info(`Found ${ourcerts.available.length} certificates.`);

// Work out which things we need to register
const things = [...[ 'services', 'shadow' ].reduce((out, opt) => {
  for (const arg of (options[opt] || []))
    out.add(splitArg(arg)[0]);
  return out;
}, new Set()).keys()];
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


const shadows = {};

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

  const comms = awsiot.thingShadow(
    Object.assign({ keepalive: 1200 }, ourcerts.preferred));
  ++comms_attempts;
  comms.on('connect', () => {
    console.info('Connected.');
    comms_attempts = 0;
    for (const thing of things) {
      const withServices = svcs[thing] != null;
      shadows[thing] = new Shadow(comms, thing, svcs[thing]);
      console.log(`Registering thing '${thing}'.`);
      comms.register(
        thing,
        { ignoreDeltas: !withServices },
        () => {
          if (dirwatches[thing] != null)
            dirwatches[thing].rescan(); // pick up any pending changes
          shadows[thing].fetch();
        }
      );
    }
  });
  comms.on('status', (thing, stat, token, resp) =>
    shadows[thing].onStatus(stat, token, resp));
  comms.on('delta', (thing, resp) =>
    shadows[thing].onDelta(resp));
  comms.on('timeout', (thing, token) => {
    shadows[thing].onTimeout(token);
    ++comms_attempts;
    checkCommsAttempts();
  });
  comms.on('error', err => {
    console.error('AWS IoT Core connection reported error:', err);
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
      cfg.claimstore, options.cacert, options.clientid, cfg.template);
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


// -- Initial startup ----------------------------------------------------

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
  connect();
}


// -- Signal and exception handling ---------------------------------------

process.on('SIGHUP', () => {
  console.info('Got SIGHUP, re-fetching shadow(s)...');
  for (const key in shadows)
    shadows[key].fetch();
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
