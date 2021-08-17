/* Copyright(C) 2019-2020 DiUS Computing Pty Ltd */
'use strict';
const child_process = require('child_process');

function SecureTunnel(thing, portmappings, localproxy, caDir) {
  this._thing = thing;
  this._localproxy = localproxy || 'localproxy';
  this._caDir = caDir;
  this._mappings = {};
  try {
    portmappings.split(',').forEach(portmap => {
      const [ key, port ] = portmap.split('=');
      this._mappings[key] = +port;
      if (isNaN(this._mappings[key]))
        throw new Error(`invalid port number: ${port}`);
    });
  }
  catch(e) {
    console.error(
      `Error parsing '${thing}' portmappings "${portmappings}": ${e}`);
    process.exit(1);
  }
}


SecureTunnel.prototype.thing = function() {
  return this._thing;
}


SecureTunnel.prototype.topic = function() {
  return `$aws/things/${this._thing}/tunnels/notify`;
}


SecureTunnel.prototype.handleMessage = function(buf) {
  try {
    const tunnelConfig = JSON.parse(buf);
    if (tunnelConfig.clientMode != 'destination')
      throw new Error(`unsupported mode '${tunnelConfig.clientMode}'`);

    this.launch(
      tunnelConfig.clientAccessToken,
      tunnelConfig.services,
      tunnelConfig.region);
  }
  catch(e) {
    console.error(`Unable to open tunnel for ${this._thing}: ${e}`);
  }
}


SecureTunnel.prototype.launch = function(accessToken, serviceList, region) {
  if (this._proc != null) {
    console.warn(`Stopping previous tunnel proxy for '${this._thing}'.`);
    this._proc.kill();
  }

  const enabled = [];
  for (const svc of serviceList) {
    if (this._mappings[svc] != null)
      enabled.push(`${svc}=${this._mappings[svc]}`);
    else
      console.warn(
        `Requested tunnel service '${svc}' for '${this._thing}' not mapped!`);
  }
  if (enabled.length == 0)
    throw new Error(`requested services not available!`);

  const args = [ '-d', enabled.join(','), ];
  if (this._caDir != null) {
    args.push('-c');
    args.push(this._caDir);
  }
  const env = {
    AWSIOT_TUNNEL_ACCESS_TOKEN: accessToken,
    AWSIOT_TUNNEL_REGION: region,
  };

  this._proc = child_process.spawn(
    this._localproxy, args, { env, stdio: 'inherit', detached: true });
  const pid = this._proc.pid;
  console.info(`Starting tunnel proxy for '${this._thing}' with services "${serviceList.join(', ')}", pid ${pid}.`);
  this._proc.on('exit', (code, sig) => {
    const msg = `Tunnel proxy for '${this._thing}', pid ${pid} exited`;
    if (code != null)
      console.info(`${msg} with code ${code}.`);
    else
      console.info(`${msg} due to ${sig}.`);
    // Clean up, but only if this._proc has already been replaced
    if (this._proc != null && this._proc.pid == pid)
      this._proc = null;
  });

  this._proc.unref(); // don't wait for proxy exit before we can exit
}


SecureTunnel.prototype.terminate = function() {
  if (this._proc != null) {
    console.info(`Terminating tunnel proxy for '${this._thing}', pid ${this._proc.pid} on request...`);
    this._proc.kill();
  }
}


module.exports = {
  SecureTunnel,
};
