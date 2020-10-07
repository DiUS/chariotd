/* Copyright(C) 2020 DiUS Computing Pty Ltd */
'use strict';

const awsiot = require('aws-iot-device-sdk');
const CertStore = require('./certstore.js');


function FleetProvisioning(certdir, caPath, clientId, templateName) {
  this._certstore = new CertStore(certdir, caPath, clientId);
  this._certs = this._certstore.getCerts();
  this._clientId = clientId;

  const tc = '$aws/certificates/create/json';
  const tp = `$aws/provisioning-templates/${templateName}/provision/json`;

  this._topics = {
    cert: tc,
    cert_accepted: `${tc}/accepted`,
    cert_rejected: `${tc}/rejected`,
    prov: tp,
    prov_accepted: `${tp}/accepted`,
    prov_rejected: `${tp}/rejected`,
  };

  this._attempts = 0;
}


FleetProvisioning.prototype._onMessage = function(topic, payload) {
  try {
    const obj = JSON.parse(payload);
    var done = true;
    switch(topic) {
      case this._topics.cert_accepted:
        this._newcert = obj;
        console.log(
          `New certificate ${obj.certificateId} created, not yet claimed.`);
        this._device.unsubscribe(this._topics.cert_accepted);
        this._device.unsubscribe(this._topics.cert_rejected);
        this._device.subscribe(this._topics.prov_accepted);
        this._device.subscribe(this._topics.prov_rejected);
        this._device.publish(this._topics.prov, JSON.stringify({
          certificateOwnershipToken: this._newcert.certificateOwnershipToken,
          parameters: this._parameters,
        }));
        done = false;
        break;
      case this._topics.cert_rejected:
        console.error('ERROR: Fleet provisioning request rejected:', obj);
        break;
      case this._topics.prov_accepted:
        console.log(`Claimed ${this._newcert.certificatedId} successfully.`);
        this._response = {
          certId: this._newcert.certificateId,
          certPem: this._newcert.certificatePem,
          certKey: this._newcert.privateKey,
          configuration: obj.deviceConfiguration,
          thing: obj.thingName,
        };
        delete(this._newcert);
        break;
      case this._topics.prov_rejected:
        console.error('ERROR: Failed to claim certificate during fleet provisioning', obj);
        break;
      default:
        console.warn(`Ignored message on unexpected topic ${topic}`, obj);
        done = false;
        break;
    }
    if (done)
      this._device.end();
  }
  catch(e) {
    console.error('ERROR: fleet provisioning failed:', e);
    this._device.end();
  }
}


FleetProvisioning.prototype.attempt = function(parameters) {
  if (this._certs.preferred == null) {
    console.error('ERROR: No valid fleet provisioning certificates available.');
    return Promise.reject();
  }
  if (this._parameters != null) {
    console.error('ERROR: re-entrant fleet provisioning attempted.');
    return Promise.reject();
  }

  this._parameters = parameters;

  const checkAttempts = () => {
    if (this._attempts > 5) {
      console.error('ERROR: Too many unsuccessful fleet provisioning attempts - exiting.');
      const next = this._certstore.roratePreferred();
      if (next.certId != this._certs.preferred.certId)
        console.info(
          `Switched fleet provisioning certificate to ${next.certId}.`);
      process.exit(1);
    }
  }

  return new Promise((resolve, reject) => {
    var device = null;
    if (this._device == null) {
      this._device = device = awsiot.device(this._certs.preferred);
      device.on('message', this._onMessage.bind(this));
      device.on('connect', () => this._attempts = 0);
      device.on('reconnect', () => {
        console.log('Reconnecting fleet provisioning connection...');
        ++this._attempts;
        checkAttempts();
      });
    }
    else
      device = this._device;

    // We don't device.off() this, but that's harmless here
    device.on('close', () => {
      delete(this._parameters);
      if (this._response == null)
        reject(new Error());
      else
        resolve(this._response);
    });

    // Cleanup from previous run
    delete(this._response);
    device.unsubscribe(this._topics.prov_accepted);
    device.unsubscribe(this._topics.prov_rejected);
    // Request a new certificate
    device.subscribe(this._topics.cert_accepted);
    device.subscribe(this._topics.cert_rejected);
    device.publish(this._topics.cert, '{}');
  });
}

module.exports = FleetProvisioning;
