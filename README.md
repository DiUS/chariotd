# chariotd - Userspace glue for AWS IoT Core

The AWS IoT Core provides handy services for provisioning IoT devices and managing their configuration settings via the Device Shadow concept. Interfacing with it from Linux userspace is not something that is provided out of the box. It is this gap that chariotd fills. Effectively it allows interaction with the IoT Core using the typical Unix primitives - files and process spawning. The design builds on the experience from several precursor implementations done for various projects, and aims to be the "best of breed" as a result.

What about the name, you ask? This project is the __c__ ommon __h__ andling for __A__ WS co __r__ e __IoT__ __d__ aemon. Part acronym, part backronym, part search optimiser, part geekery.


## Quick examples

Without delving into the details, here are some examples how the different facets might be used.

### Posting to MQTT topics

  1. Launch chariotd with `--messages` to listen for messages to upload: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --messages=/var/chariotd/mqtt`
  1. Prepare a new message to publish: `echo '{ "topic": "mytopic/foo", "payload": { "key": "value", "key2": 2 } }' > /var/chariotd/mqtt/tmp/foomsg`
  1. Publish it: `mv /var/chariotd/mqtt/tmp/foomsg /var/chariotd/mqtt/new/`

### Updating a device shadow

  1. Launch chariotd with `--updates` to listen for updates to apply to the device shadow: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --updates=MyThing:/var/chariotd/shadow`
  1. Prepare an update for the "foo" key in the shadow: `echo '{ "led1": "red", "led2": "green" }' > /var/chariotd/shadow/tmp/foo`
  1. Publish the update: `mv /var/chariotd/shadow/tmp/foo /var/chariotd/shadow/new`

### Hook a device shadow key to a service

  1. Write the service definition to /var/chariotd/svcs/foo.js:
```
     module.exports = {
       key: 'foo',
       outfile: '/config/foo.rc',
       outformat: 'SHELL',
       informat: 'SHELL',
       notifycmd: 'sv restart foo',
     }
```
  1. Launch chariotd with `--services` to monitor a device shadow for setting changes: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --services=MyThing:/var/chariotd/svcs`
  1. Whenever the contents of the "foo" key in the device shadow for "MyThing" doesn't match the contents of "/config/foo.rc", that file gets updated and the "foo" service restarted.

### Using fleet provisioning

  1. Write the fleet provisioning config to /var/chariotd/fp.json:
```
    {
      "claimstore": "/config/factory/cert",
      "template": "my-provisioning-template",
      "parameters": {
        "SerialNumber": "1234"
      }
    }
```
  1. Launch chariotd with `--fleetprov` to enable initial device provisioning via AWS fleet provisioning: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --fleetprov=/var/chariotd/fp.json
  1. If there is no device certificate available in the certstore, a fleet provisioning attempt will be started, and if successful the new certificate is saved to the certstore.


## Running chariotd

When running chariotd there are a few mandatory options:

  1. `--clientid` - Each connection to the AWS IoT endpoint must have a unique client id. If there is an existing connection open to AWS IoT with the same client id, the old connection is closed. This helps discard old connections faster than otherwise possible, but it can also result in a "tug-o-war" over a client id if not careful. It is recommended to base the client id on a unique device identifier, such as a system serial number of MAC address. On embedded Linux systems it is not uncommon to find a SoC serial number in `/proc/cpuinfo` for example.
  1. `--cacert` - To authenticate the AWS IoT endpoint and guard against man-in-the-middle attacks, the AWS Certificate Authority's root certificate must be available on the device. The certificate can be downloaded from https://www.amazontrust.com/repository/AmazonRootCA1.pem but SHOULD BE PREINSTALLED ON THE DEVICE. Do not simply download it to the device "on demand". The certificate should be validated against the official hashes/signatures to ensure it is in fact the correct certificate.
  1. `--certstore` - This is the path to where the device certificates are kept. It must be read/write accessible, so that chariotd can deploy new certificates to it (if fleet provisioning is in use) and maintain the `preferred` symlink within the certstore. If using fleet provisioning and starting without any device certificates, the certstore must still have a valid `endpoint.txt` file (see [Directory structures](#directory-structures) section).

Past this the features are pick-and-choose.

  - `--fleetprov` - Enables fleet provisioning with the specified configuration, which will be attempted in the absence of any device certificates and optionally on a command request. See the [Fleet provisioning](#fleet-provisioning) section for details on configuration.
  - `--services` - Loads service definitions for the specified thing and monitors the device shadow for updates to the corresponding parts of the shadow. Refer to [Service definitions](#service-definitions) for details.
  - `--updates` -- Tells chariotd to watch for requests to update a thing's device shadow. Details available in the [Shadow updates](#shadow-updates) section.
  - `--defaultshadow` - Enables seeding of a thing's device shadow if it does not yet exist. Refer to [Default shadow creation](#default-shadow-creation) for specifics on using this feature.
  - `--messages` - Instructs chariotd to watch for MQTT publish requests. The specifics are available in the [Message publishing](#message-publishing) section.
  - `--commands` - Makes chariotd listen for command requests. Available commands which may be sent are listed in the [Command requests](#command-requests) section.


## Restarting chariotd

One very important aspect to be aware of is that chariotd MUST be run under a service supervisor. A core aspect of its functioning is that it expects to be able to rely on being restarted when it exits. This is largely driven by experience having shown the hard way that things can get gummed up and stalled in a way which can only be resolved by restarting the entire process. There are a myriad of ways things can go wrong when operating in an environment with intermittent network connectivity, and over time and a large enough install base edge cases start getting hit. Thus, chariotd takes the attitude that if it keeps experiencing connectivity failures, the best it can do for everyone is exit and have the service supervisor restart it afresh.

For embedded Linux systems, the service supervisor of choice is typically [runit](http://smarden.org/runit/), or the [BusyBox](https://busybox.net/) implementation thereof.

When chariotd exists due to communications failure and there are multiple certificates available, prior to exiting it will update the `preferred` symlink to point to the next certificate. On the subsequent run it will then try using the different certificate. Repeat as necessary.


## Directory structures

### Certificate stores

In order to easily handle certificate rotation chariotd is designed around the concept of certificate stores rather than single certificate. A certificate store is simply a base directory containing an `endpoint.txt` file listing the AWS IoT endpoint the certificates apply to, and a number of sub directories with each containing a certificate and associated private key.

E.g.:
```
/path/to/certstore/
  - endpoint.txt
  - 95b9dfa3efa5c5660c506eb8fe67712bf431201140fd2f2ea10719b88b6b7412/
     - 95b9dfa3efa5c5660c506eb8fe67712bf431201140fd2f2ea10719b88b6b7412-certificate.pem.crt
     - 95b9dfa3efa5c5660c506eb8fe67712bf431201140fd2f2ea10719b88b6b7412-private.pem.key
```

When running, chariotd will also maintain a `preferred` symlink within the certstore pointing to the certificate which will be used next. This symlink is automatically created if not already present.


### Action directories

For directories which serve as the watch point for upload requests, be it mqtt publishing or device shadow updates, these follow a common layout:
```
/path/to/dir:
  - tmp/
  - new/
  - failed/
```
A new request is prepared (written to) in the `tmp/` sub directory, and once fully written it gets _moved_ into `new/`, at which point `chariotd` will pick it up for processing. This is the standard pattern for ensuring that only fully written files are actioned; Within the same filesystem the move operation is atomic, and as long as the file in `tmp/` has been closed before it is moved, the full contents is guaranteed to be available when it appears in `new/`.

If the processing of a file fails for any reason, it will be moved to the `failed/` folder, where it can be inspected (for debugging purposes). To avoid the disk filling up with failed requests, chariotd only keeps the last N failed requests. If for some reason a failed request cannot be relocated to this folder, it is simply deleted instead.

In the case where there are already files present in the `new/` directory when chariotd starts, these will be sorted by filename and processed in that order as if they were being moved into the directory.


## Service definitions

The approach chariotd takes is to treat each top-level key in the device shadow as belonging to a separate service. For example, there may be a key named "firmware" which holds all the settings for firmware selection and upgrading, another key named "network" which provides manual network settings, yet another key called "yourapp" which contains the settings for your app, etc. This provides clean separation of concerns, and when settings change only the service whose setting(s) were changed needs to be notified.

A service definition is written as a [Common JS module](https://nodejs.org/docs/latest/api/modules.html). While the typical service definition would have easily be handled by a JSON format, experience has shown that it is better to err on the side of flexibility in this area.

The service definition is expected to export an object with _at least_ these keys:
  - `key` - The top-level key in the device shadow this service uses.
  - `outfile` - Full path to the file where this service's configuration will be written.
  - `outformat` - Format of the "outfile". See [Service outfile formats](#service-outfile-formats) for available formats.
  - `informat` - Format used for shadow updates; same options as for "outformat". It does NOT have to be the same as "outformat".
  - `notifycmd` - The command to issue whenever the "outfile" has been updated.

Additionally the following keys may be included:
  - `outkeys` - An array of subkey names. Limits what will be written to "outfile" to only those subkeys. This is useful for services which report frequently updating values in the shadow, but has no interest in reading those values back in. As the "notifycmd" is only invoked when the "outfile" has changed, this field also has the effect of limiting when the service gets notified.
  - `notifykeys` - An array of subkey names. Only invokes the "notifycmd" if a subkey named in this list has changed its value. Similar to "outkeys" but without limiting the information saved into "outfile".


Example:
```
module.exports = {
  key: 'firmware',
  outfile: '/config/firmware.rc',
  outformat: 'SHELL',
  informat: 'SHELL',
  notifycmd: 'sv up firmware',
}
```

### Service outfile handling

The "outfile" is compared against whenever new device shadow data is available for a service. If there is a change detected, the updated data is written to a temporary file which is then renamed to the "outfile". This ensures only fully written configuration files are seen under that name. The one exception to this is if the "outfile" is the literal name `/dev/null`, in which case the writing is skipped altogether - nobody has a good day when their /dev/null has turned into a regular file!

### Service outfile formats

#### JSON

The JSON outfile format is pretty self-explanatory. The only slightly odd aspect is that `null` values are not possible, due to the way the AWS IoT Device Shadow engine handles them (uses them to indicate key removal).

#### SHELL

The SHELL output format implements a subset of shell variable assignment. Depending on the data types used in the shadow, the resulting outfile may be Bourne Shell compatible or only Bourne-Again Shell (bash) compatible (due to array assignment). The format is easist explained with a comprehensive example:
```
{
  a: 1,
  b: "str",
  c: "with spaces",
  d: "with single ' quote",
  e: 'with double " quote',
  f: true,
  g: false,
  h: -64.2,
  i: [ 1, 2, 3 ],
  j: [ 'x ', 'y ', ' z' ],
  k: [],
  l: "",
  nested: {
    x: {
      y: {
        z1: [ true ],
        z2: 'something else',
      },
      yy: 42,
    }
  },
}
```
becomes:
```
a='1'
b='str'
c='with spaces'
d='with single \' quote'
e='with double " quote'
f='true'
g='false'
h='-64.2'
i=('1' '2' '3')
j=('x ' 'y ' ' z')
k=()
l=''
nested_x_y_z1=('true')
nested_x_y_z2='something else'
nested_x_yy='42'
```

The reverse transformation is used for "informat", though it is a bit more lenient with the quotes.

Note that when using the SHELL format, you are limited in what you can name your keys, as the key names have to also be valid shell variable names.


## Shadow updates

Option to enable: `--updates=THING:/path/to/dir/to/watch`
Directory structure: [action directory](#action-directories)

Enables the updating sections of a things's device shadow by putting files into the watched directory.

### Shadow update file naming

The name of the file indicates which top-level key in the device shadow is to be updated. As there may be many partial updates being posted, the filename may also be in the format `shadowkey.timestamp` where only the part before the dot is used as the key.

If there are shadow updates already available in the `new/` sub directory when chariotd connects, they will be sorted by filename and processed in that order. Provided the `shadowkey.timestamp` naming was used, this ensures the final state arrived at is the correct one.

### Shadow update file content

The content of the file will be _merged_ into the device shadow at that location, per the usual device shadow update rules. By default the file format is expected to be JSON, but this may be overridden in a corresponding [service definition](#service-definitions).

To request the deletion of a key, in addition to passing a `null` value the reserved value `DELETE` may be used, just as if the update request had come in via the "desired" part of the device shadow.


## Default shadow creation

Option to enable: `--defaultshadow=THING:/path/to/cmd`

Instructs chariotd to register for the thing named `THING`, and if there is no device shadow document for said thing, run the command `/path/to/cmd` and use its output to seed the initial device shadow.

The output from the command MUST be valid [JSON](https://www.json.org) and meet any other requirements for a device shadow document. The output will be posted as the "reported" part of the shadow document, and will be propagated to any services as applicable.

While it is possible to include parameters to the command in the chariotd command line option by using appropriate quoting for the shell, it is discouraged. If the command needs to know the thing name, it may read it from its `stdin` where it is available as the only input.


## Message publishing

Option to enable: `--messages=/path/to/dir/to/watch`
Directory structure: [action directory](#action-directories)

Allows userspace processes to publish messages to MQTT topics by way of writing files to the watched directory.

### Message file naming

The file name has no special meaning. To avoid name conflicts it is recommended that each writer uses a prefix unique to said writer. Depending on whether only the latest message from a writer is desired, or all messages, a suffix containing a timestamp may be used to avoid overwriting previous unprocessed files. This scenario often comes up while the device is out of network connectivity. Be sure to implement some manner of disk space limiting to avoid filling a disk and being unable to buffer new messages.


### Message file content

The message file is in [JSON](https://www.json.org) and contains two mandatory top-level keys - `topic` and `payload`. Optionally the key `qos` may be used to indicate the MQTT quality-of-service level to request.

```
{
  "topic": "my/topic/of/something",
  "qos": 1,
  "payload": {
    "key": "my data",
    "more": true
  }
}
```


## Command requests

Option to enable: `--commands=/path/to/dir/to/watch`
Directory structure: [action directory](#action-directories)

When used, allows command requests to be sent to the running chariotd process. The filename is the name of the command. Command arguments, if any, are contained within the file.

### Supported commands

#### refetch

Parameters: none.

Immediately refetches the device shadow(s) for the registered thing(s). Should not be needed under normal operation, but may be helpful for debugging.

Sending the chariotd processes the `SIGHUP` signal has the same effect.

#### reprovision

Parameters: none.

Causes chariotd to run a fleet provisioning attempt. The main use case for this is to deploy a new certificate to a device. Be sure to do this prior to the old certificate expiring!

If chariotd was started without `--fleetprov` this command is not available, for obvious reasons.


## Fleet provisioning

Option to enable: `--fleetprov=/path/to/config.json`

As part of the initial device startup, chariotd can provision the device using the [AWS Fleet Provisioning](https://docs.aws.amazon.com/iot/latest/developerguide/provision-wo-cert.html) method, using a preloaded factory claim (certificate).

When enabled, fleet provisioning automatically kicks in if there are no device certificates available (and optionally [on request](#reprovision)). After fleet provisioning has completed, chariotd will exit with the expectation of being restarted and thus pick up the newly added certificate.

If so desired it is possible to hook into the fleet provisioning upon completion. This can be useful if the device cannot predict the thing name it will receive in response to the provisioning.

### Fleet provisioning configuration file

The fleet provisioning configuration is written in [JSON](https://www.json.org) and has the following mandatory keys:
  - `claimstore` - The [certificate store](#certificate-stores) for the factory claim certificate(s).
  - `template` - Name of the [fleet provisioning template](https://docs.aws.amazon.com/iot/latest/developerguide/provision-template.html) to request during provisioning.
  - `parameters` - An object with any and all parameters required by the used template. This will normally include some manner of serial number or other device identifier.

There are also additional optional keys that may be used:
  - `outfile` - When specified, the results of the fleet provisioning will be written to this file. See [fleet provisioning outfile](#fleet-provisioning-outfile) for details on its contents.
  - `outformat` - The [format](#service-outfile-formats) to use when writing `outfile`. Required if "outfile" is specified.
  - `notifycmd` - A command to issue after fleet provisioning has completed. It is given no extra arguments or input.

Example:
```
{
  "claimstore": "/config/factory/cert",
  "template": "my-provisioning-template",
  "parameters": {
    "SerialNumber": "1234"
  },
  "outfile": "/config/provisioning-results.json"
  "ouformat": "JSON",
  "notifycmd": "/usr/sbin/fleet-provisioning-done"
}
```

### Fleet provisioning outfile

The provisioning result comprises two things, the thing name and the device configuration. The thing name may or may not be possible for the device to pre-determine (it depends on the provisioning template), and it is thus returned as a provisioning output.

If the template contains a `DeviceConfiguration` section those settings become available under the `configuration` key in the outfile.

Example JSON outfile:
```
{
  "thing": "thing-name-per-template-decree",
  "configuration": {
    "your-parameter": "shows up here",
  }
}
```

