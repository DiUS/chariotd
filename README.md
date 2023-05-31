# chariotd - Userspace glue for AWS IoT Core

The AWS IoT Core provides handy services for provisioning IoT devices and managing their configuration settings via the Device Shadow concept. Interfacing with it from Linux userspace is not something that is provided out of the box. It is this gap that chariotd fills. Effectively it allows interaction with the IoT Core using the typical Unix primitives - files and process spawning. The design builds on the experience from several precursor implementations done for various projects, and aims to be the "best of breed" as a result.

What about the name, you ask? This project is the **c**ommon **h**andling for **A**WS co**r**e **IoT** **d**aemon. Part acronym, part backronym, part search optimiser, part geekery.


## Quick examples

Without delving into the details, here are some examples how the different facets might be used.

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
  1. Launch chariotd with `--fleetprov` to enable initial device provisioning via AWS fleet provisioning: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --fleetprov=/var/chariotd/fp.json`
  1. If there is no device certificate available in the certstore, a fleet provisioning attempt will be started, and if successful the new certificate is saved to the certstore.

### Publishing to MQTT topics

  1. Launch chariotd with `--messages` to watch for messages to upload: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --messages=/var/chariotd/mqtt`
  1. Prepare a new message to publish: `echo '{ "topic": "mytopic/foo", "payload": { "key": "value", "key2": 2 } }' > /var/chariotd/mqtt/tmp/foomsg`
  1. Publish it: `mv /var/chariotd/mqtt/tmp/foomsg /var/chariotd/mqtt/new/`

### Subscribing to MQTT topics

  1. Launch chariotd with one of `--subscribe-write` or `--subscribe-exec` to handle messages received on a topic, e.g.: `chariotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --subscribe-exec=mytopic/foo:/path/to/handler`

Now `/path/to/handler` will be executed whenever a message is received on `mytopic/foo` and passed the message on stdin.

### Using secure tunneling

  1. Ensure the [`localproxy`](https://github.com/aws-samples/aws-iot-securetunneling-localproxy) has been installed.
  1. Ensure the Amazon root CA certificate is available in an OpenSSL [compatible](https://github.com/aws-samples/aws-iot-securetunneling-localproxy#certificate-setup) location.
  1. Launch chariotd with `--tunnelmappings` to listen for tunnel requests: `chairotd --clientid=myclient --cacert=/path/to/AmazonRootCA1.pem --certstore=/var/chariotd/certs --tunnelmappings=MyThing:SSH=22,HTTPS=443 --tunnelproxy=/path/to/bin/localproxy`
  1. If necessary, explicitly point chariotd at the directory where the Amazon root CA certificate can be found using e.g. `--tunnelcadir=/var/chariotd/tunnelca`.
  1. Open a tunnel session using e.g. the [AWS Console](https://docs.aws.amazon.com/iot/latest/developerguide/secure-tunneling-tutorial.html#open-tunnel) or the AWS CLI tool (`aws iotsecuretunneling open-tunnel ...`).
  1. Start a local proxy in [source mode](https://docs.aws.amazon.com/iot/latest/developerguide/secure-tunneling-tutorial.html#start-local-proxy), e.g. `localproxy -r ap-southeast-2 -s SSH=2222,HTTPS=4443 -t AQGAAXgU4...`.
  1. Check that the tunnel session shows both endpoints connected, e.g. using the AWS Console or the CLI (`aws iotsecuretunneling describe-tunnel --tunnel-id=...`).
  1. Connect through the proxy, e.g. `ssh -p 2222 user@localhost`.

## Additional reading

There is also a [blog post](https://dius.com.au/2020/11/12/using-aws-iot-core-on-embedded-linux/) available, discussing how to integrate chariotd into an embedded Linux IoT device project.

## Running chariotd

When running chariotd there are a few mandatory options:

  1. `--clientid` - Each connection to the AWS IoT endpoint must have a unique client id. If there is an existing connection open to AWS IoT with the same client id, the old connection is closed. This helps discard old connections faster than otherwise possible, but it can also result in a "tug-o-war" over a client id if not careful. It is recommended to base the client id on a unique device identifier, such as a system serial number or MAC address. On embedded Linux systems it is not uncommon to find a SoC serial number in `/proc/cpuinfo` for example.
  1. `--cacert` - To authenticate the AWS IoT endpoint and guard against man-in-the-middle attacks, the AWS Certificate Authority's root certificate must be available on the device. The certificate can be downloaded from https://www.amazontrust.com/repository/AmazonRootCA1.pem but SHOULD BE PREINSTALLED ON THE DEVICE. Do not simply download it to the device "on demand". The certificate should be validated against the official hashes/signatures to ensure it is in fact the correct certificate.
  1. `--certstore` - This is the path to where the device certificates are kept. It must be read/write accessible, so that chariotd can deploy new certificates to it (if fleet provisioning is in use) and maintain the `preferred` symlink within the certstore. If using fleet provisioning and starting without any device certificates, the certstore must still have a valid `endpoint.txt` file (see [Directory structures](#directory-structures) section).

Past this the features are pick-and-choose.

#### Fleet provisioning related

  - `--fleetprov` - Enables fleet provisioning with the specified configuration, which will be attempted in the absence of any device certificates and optionally on a command request. See the [Fleet provisioning](#fleet-provisioning) section for details on configuration.

#### Device shadow related

  - `--services` - Loads service definitions for the specified thing and monitors the device shadow for updates to the corresponding parts of the shadow. Refer to [Service definitions](#service-definitions) for details.
  - `--updates` -- Tells chariotd to watch for requests to update a thing's device shadow. Details available in the [Shadow updates](#shadow-updates) section.
  - `--defaultshadow` - Enables seeding of a thing's device shadow if it does not yet exist. Refer to [Default shadow creation](#default-shadow-creation) for specifics on using this feature.
  - `--empty-array-as-delete-request` - Specifies that empty arrays should be treated the same as `"DELETE"`, i.e. as a request to remove a key from the shadow. This was the early canonical way of submitting such requests, and this feature is provided for backwards compatibility and should not typically need to be used.

#### Message publishing related

  - `--messages` - Instructs chariotd to watch for MQTT publish requests. The specifics are available in the [Message publishing](#message-publishing) section.
  - `--default-message-concurrency` and `--message-concurrency` - Controls how many inflight messages should be allowed.
  - `--default-message-retries` and `--message-retries` - Configures how many extra attempts will be made to publish a message.
  - `--default-message-jam-timeout` and `--message-jam-timeout` - Sets the time before declaring a message queue jam.
  - `--default-message-order` and `--message-order` - Sets the preferred upload order of messages.
  - `--default-message-topic-prefix` and `--message-topic-prefix` - Modifies the topic in each message with the given prefix.
  - `--default-message-topic-suffix` and `--message-topic-suffix` - Modifies the topic in each message with the given suffix.
  - `--default-letterhead-file` and `--letterhead-file` - Specifies a static letterhead for messages.
  - `--default-letterhead-generator` and `--letterhead-generator` - Specifies a dynamic letterhead for messages.

#### Message subscription related

Refer to the [Message subscription](#message-subscription) sections for details.

 - `--subscribe-write` - Subscribes to a topic and writes received messages to the specified destination (such as a named pipe).
 - `--subscribe-exec` - Subscribes to a topic and executes the specified application whever a message is received, passing said message to the launched process via its stdin.

#### Secure Tunneling related

  - `--tunnelmappings` - Enables listening for AWS IoT Secure Tunneling requests. Details available in the [Secure Tunneling](#secure-tunneling) section.
  - `--tunnelproxy` - Specifies the path to the secure tunneling proxy client to use.
  - `--tunnelcadir` - Specifies the directory where the tunnel proxy client can find the Amazon root CA certificate in an OpenSSL compatible format.

#### Last Will & Testament related

  - `--last-will-topic` - Sets the topic any Last-Will-and-Testament payload should be published to. To be used in conjunction with `--last-will-payload`.
  - `--last-will-payload` - Specifies the payload of a Last-Will-and-Testament message to be registered with the AWS IoT Gateway, to be published if the client disconnects unexpectedly. The destination topic is set with `--last-will-topic`.

#### Miscellaneous
  - `--commands` - Makes chariotd listen for command requests. Available commands which may be sent are listed in the [Command requests](#command-requests) section.
  - `--keepalive` - This can be used to override the keepalive interval, which by default is set to 1200. Devices communicating through a [NAT](https://en.wikipedia.org/wiki/Network_address_translation) device may need to use a lower keepalive interval to avoid the session state expiring in the NAT device.


## Restarting chariotd

One very important aspect to be aware of is that chariotd MUST be run under a service supervisor. A core aspect of its functioning is that it expects to be able to rely on being restarted when it exits. This is largely driven by experience having shown the hard way that things can get gummed up and stalled in a way which can only be resolved by restarting the entire process. There are a myriad of ways things can go wrong when operating in an environment with intermittent network connectivity, and over time and a large enough install base edge cases start getting hit. Thus, chariotd takes the attitude that if it keeps experiencing connectivity failures, the best it can do for everyone is exit and have the service supervisor restart it afresh.

For embedded Linux systems, the service supervisor of choice is typically [runit](http://smarden.org/runit/), or the [BusyBox](https://busybox.net/) implementation thereof.

When chariotd exits due to communications failure and there are multiple certificates available, prior to exiting it will update the `preferred` symlink to point to the next certificate. On the subsequent run it will then try using the different certificate. Repeat as necessary.


## Directory structures

### Certificate stores

In order to easily handle certificate rotation chariotd is designed around the concept of certificate stores rather than single certificate. A certificate store is simply a base directory containing an `endpoint.txt` file listing the AWS IoT endpoint the certificates apply to, and a number of sub directories with each containing a certificate and associated private key.

The `endpoint.txt` may contain either just the hostname of the IoT endpoint,
or hostname and port number in the form of `hostname:port`. The latter can
be used to switch from the standard MQTTS port (8883) to the HTTPS port (443).
This can be necessary when located behind a restrictive firewall which does
not permit outbound MQTTS traffic, but does allow HTTPS. Internally, the
ALPN TLS option is automatically set to `x-amzn-mqtt-ca` whenever port
443 is specified.

Example:
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

Example shadow document:
```
{
  "reported": {
    "firmware": {
      "running": "2.0.1",
      "wanted": "2.0.1",
      "url": "https://www.example.com/firmware/cool-device-2.0.1.bin"
    },
    "network": {
      "dns": [ "1.1.1.1", "8.8.8.8" ]
    },
    "yourapp": {
      "foo": "bar",
      "frob": {
        "extra": true,
        "baz": "nope"
      }
    }
  }
}
```

A service definition is written as a [Common JS module](https://nodejs.org/docs/latest/api/modules.html). While the typical service definition would have easily be handled by a JSON format, experience has shown that it is better to err on the side of flexibility in this area.

The service definition is expected to export an object with _at least_ these keys:
  - `key` - The top-level key in the device shadow this service uses.
  - `outfile`\* - Full path to the file where this service's configuration will be written.
  - `outformat`\* - Format of the "outfile". See [Service outfile formats](#service-outfile-formats) for available formats.
  - `informat` - Format used for shadow updates; same options as for "outformat". It does NOT have to be the same as "outformat". Defaults to "JSON".
  - `notifycmd` - The command to issue whenever the "outfile" has been updated.

Additionally the following keys may be included:
  - `outkeys` - An array of subkey names. Limits what will be written to "outfile" to only those subkeys. This is useful for services which report frequently updating values in the shadow, but has no interest in reading those values back in. As the "notifycmd" is only invoked when the "outfile" has changed, this field also has the effect of limiting when the service gets notified.
  - `notifykeys` - An array of subkey names. Only invokes the "notifycmd" if a subkey named in this list has changed its value. Similar to "outkeys" but without limiting the information saved into "outfile".
  - `initialnotify` - A boolean flag which if set triggers a notification of the service when the shadow is initially fetched. Keep in mind that this does _not_ equate to notify-on-system-startup, as the chariotd service may be restarted at times.
  - `validate` - A function to validate any configuration changes before they are accepted. This can be used to prevent semantically invalid configurations. The default function is effectively `cfg => cfg`, meaning it accepts any parsable configuration object. The passed configuration is the _full_ configuration with any delta pre-applied. To completely reject a configuration update, throw an `Error`, in which case that will be logged and the update discarded. The outfile will not be updated, nor will the notify command be invoked. The function may also perform a "fix-up" of the configuration, for example clamping values to be within an appropriate range. Said fixup may be done either directly in the provided configuration object or the entire object may be replaced. Whatever is returned from the `validate()` is used as the new configuration for the service. If this differs from the old configuration, the usual change processing and notification will take place. Note that returning `null` (or `undefined`) from this function will lead to the service's section being removed from the shadow, so make sure you don't do that accidentally.
  - `ephemeraldata` - A boolean flag which if set treats any updates for this service as ephemeral and does not persist it. The `validate()` function will still be called, but `outfile` will never be written. This flag is intended for special-case services where updates act as one-short commands, such as a `reboot` service.
   - `timeout` - The timeout, in seconds, to wait for `notifycmd` to complete. Defaults to 10 seconds, which should be plenty in almost all situations.

\*) If `ephemeraldata` is flagged, neither `outfile` nor `outformat` needs to be present.


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

Out of the box chariotd supports a few common configuration file formats. It is possible to extend this by adding new definitions in the `src/filefmts/` directory. A file format is simply a module exposing `parse(data)` and `stringify(data)` functions, analogous to the standard `JSON` module. The `stringify(data)` is responsible for converting `data` into the appropriate representation to be written to the outfile, and `parse(data)` for converting such a representation back into standard JavaScript types (object, arrays, strings, numbers). The existing modules can be used as an implementation guide for new file formats.

The file format is named as the uppercased version of the basename of the file. E.g. `shell.js` provides `SHELL` and `json.js` provides `JSON`.

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

#### PLAINTEXT

Can be used for services which only contain a single text-string as its associated configuration in the device shadow. Allows for a simple method of populating a text file directly from the shadow.


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

This option may be specified more than once, in order to watch for message upload requests in multiple action directories. Each action directory may be configured separately, for example allowing for different letterheads or topic prefixes.

There are several message configuration options, and each of them come in two flavours - default, and directory-specific. As implied, a value set using the default option applies to all message directories, unless overridden. A directory-specific option on the other hand, applies a setting only to that instance and *overrides the default value*.

### Message publishing concurrency, retries and timeouts

Each message publishing action directory has a setting for how many messages it will allow to be inflight at the same time. This is governed by the `--default-message-concurrency=N` or `--message-concurrency=/path/to/msgs:N` command line option, where at most `N` messages will be published-but-not-yet-acknowledged at any given time. This value may be tuned to suit your needs, and the optimal value will depend on many things such as QoS levels used, network latency and tendency for a backlog to build up. The default `N` is set to 10. It should be noted that increasing this value may in fact make things slower, and in some circumstances reducing it down to 1 could yield the best result.

In the interest of reliability, messages may be attempted to be published more than once if at first the publishing is unsuccessful. This is controlled via the `--default-message-retries=N` or `--message-retries=/path/to/msgs:N` where `N` is the number of *retries* (i.e. one less than the total number of attempts). If no retries are desired, this may be set to zero. If a message fails after the retry limit has been reached, the message will be moved to the `failed` directory.

To prevent message publishing from stalling silently, each message publishing action directory has an associated "jam" detection time that can be configured. Whenever the publisher reaches the maximum concurrency this timer starts, and if none of the inflight messages get acknowledged before the timer expires, a queue jam is declared. This will trigger chariotd to exit in order to be relaunched with fresh state, in the hope that this will resolve the publishing blockage.

The queue jam timer is configured with `--default-message-jam-timeout=SEC` or `--message-jam-timeout=/path/to/msgs:SEC` where `SEC` is the number of seconds to allow before declaring a jam. The default is 300 (5 minutes), which should be an excessive but safe default.

### Message topic modifications

While each message contains the topic it is destined for, that topic may be modified by way of a prefix and/or a suffix. This may be necessary for reasons such as routing messages into a test environment, or appending a device-unique identifier to easily achieve device-unique topics.

The topic prefix may be configured using `--default-message-topic-prefix=PREFIX` or `--message-topic-prefix=/path/to/msgs:PREFIX`. The suffix may be similarly configured using `--default-message-topic-suffix=SUFFIX` or `--message-topic-suffix=/path/to/msgs:SUFFIX`.

### Message file naming

The file name has no special meaning. To avoid name conflicts it is recommended that each writer uses a prefix unique to said writer. Depending on whether only the latest message from a writer is desired, or all messages, a suffix containing a timestamp may be used to avoid overwriting previous unprocessed files. This scenario often comes up while the device is out of network connectivity. Be sure to implement some manner of disk space limiting to avoid filling a disk and being unable to buffer new messages.

### Message file content

The message file is in [JSON](https://www.json.org) and contains two mandatory top-level keys - `topic` and `payload`. Optionally the key `qos` may be used to indicate the MQTT quality-of-service level to request. The default QoS is 1, for "at least once" delivery.

The payload itself may be given either as an object, in which case it will be JSON encoded prior to publishing, or it may be given as a string in which case no addition encoding is done.

```
{
  "topic": "my/topic/of/something",
  "qos": 0,
  "payload": {
    "key": "my data",
    "more": true
  }
}
```

#### Priority handling

Sometimes it is of relevance in which order messages are published. In a sunny-day scenario all messages are immediately published as soon as they are created, but at less sunny times a backlog will build up. How said backlog is handled is what the priority handling is all about. There are three types of priority ordering supported by chariotd:

  - Basic ordering
  - Priority ordering
  - Priority-slot based ordering

Basic ordering is configured at launch time by the `--default-message-order` and `--message-order` options. These may be set to one of the following values: `lexical`, `reverse-lexical`, `newest-first` or `oldest-first`. If not specified at all, it will default to `lexical`, meaning the backlog will be processed based on the message filenames. For the time-based options, the filesystem's `mtime` is used, which would typically correspond to the creation time of said message.

Priority ordering allows individual messages to "jump the queue". Any message with a `priority` key set will be given preferential treatment and published before messages without a priority key. This is ideal for messages which may not be desirable to have linger in the backlog, such as latest status messages. The `priority` key itself is a numeric value, with smaller numbers having higher priority. A message with `"priority": 1` will be published before one with `"priority": 2` (assuming they're in the backlog, of course).

Priority-slot based ordering expands upon the priority ordering. In many cases what's wanted is not to have *all* status messages prioritised, only the *newest*. This is where priority slots come in. A message with a `priority_slot` key *only gets priority if its newer* than the previously newest backlogged message with the *same* `priority_slot` key. Multiple message producers may (and should) use their own `priority_slot` values (strings are recommended, ideally the name of the producer). When a `priority_slot` marked message is indeed the newest, it is put into the priority queue with its specified `priority`, or 1 if the `priority` key was not present. Any message which is (already not, or no longer) the newest gets demoted to the default queue and published according to the basic ordering.

An example will hopefully make things clear. Assume we have the following messages waiting when chariotd is started, thus making them go straight into the backlog:

| Filename | Timestamp | Priority keys |
| :------: | :-------: | :------------ |
|    A     |   23:12   |               |
|    B     |   11:51   | `"priority"`: 2 |
|    C     |   03:22   | `"priority_slot"`: "xyz", `"priority"`: 1 |
|    D     |   11:51   | `"priority_slot"`: "xyz", `"priority"`: 1 |
|    E     |   16:20   | `"priority"`: 3 |
|    F     |   11:45   |               |


With basic ordering set to the default, the publishing order would be:

```
D -> B -> E -> A -> C -> F
```

Here, C gets demoted from the priority queue when D is encountered, and gets put after A due to lexical ordering.


With basic ordering set to `oldest-first`, it would instead be:

```
D -> B -> E-> > C -> F -> A
```

Again, C gets demoted when D is encountered, but due to its age goes before the other non-priority messages.

#### Payload compression

The message payload may be automatically compressed right before publishing by setting the `compress` key to a supported value. The following are supported:

  - `deflate` - Compress using the ["deflate"](https://datatracker.ietf.org/doc/html/rfc1950) algorithm.
  - `gzip` - Compress into the ["gzip"](https://datatracker.ietf.org/doc/html/rfc1952) format (which may use `deflate` internally).

Specifying an unsupported compression will result in a warning, and the message will be *published without compression*.

If the `payload` is given as an object, then it is JSON encoded prior to compression. Otherwise the payload value is passed straight to the compressor.

Example:
```
{
  "topic": "my/topic",
  "compress": "gzip",
  "payload": {
    "meaning": 42,
    "supporting_data": [ 1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, ... ]
  }
```

### Letterheads

In addition to the actual content in a message file, it is possible to also specify that a "letterhead" should be used. This is a JSON structure which is either loaded from a file or from the output of a process, and is used as the basis on which to overlay the content from the message file.

The letterhead follows the same format as the message itself, and can for example be used to fill in constant fields, such as a device identifier. This could remove the need for the message creating process to have or pass through such knowledge. This may be of particular use on devices hosting multiple logical entities. Another potential benefit is that the letterhead may be changed without stopping the message generating process.

Note that a letterhead is only loaded as a message is about to be published, and it is therefore **not** possible to set `priority` or `priority_slot` in the letterhead and have it take any effect.

Also note that when both a default letterhead and a directory-specific letterhead are given, there is no "stacking" of the actual letterheads — the directory-specific letterhead *replaces* the default one.

Letterheads are obtained in one of two ways — either from a file, or from the output of running a command.

#### Letterhead from a file

To source a letterhead from a file, use the command line option `--default-letterhead-file=/path/to/letterhead` or `--letterhead-file=/path/to/msgs:/path/to/letterhead`, for a default or directory-specific letterhead respectively.

Right before publishing, the specified file is loaded and parsed from JSON into an object, and the message is applied on top of that object.

If wishing to update the letterhead while chariotd is running, please ensure an atomic replace is used (same as with action directories) to avoid loading an incomplete file.

Failing to obtain the letterhead will result in a failure to publish the message.

#### Letterhead from a command

To source a letterhead from a command, use the command line option `--default-letterhead-generator=/path/to/command` or `--letterhead-generator=/path/to/msgs:/path/to/command` for a default or directory-specific letterhead respectively.

Right before publishing, the specified command (*without arguments*) is executed and its output is parsed from JSON into an object, and the message is applied on top of that object. If the generator commands needs arguments, please use a wrapper shell script.

Message metadata is provided to the generator command via environment variables.

| Variable | Content |
| :------- | :------ |
| `MESSAGE_TOPIC` | The full topic string, after any prefix/suffix has been applied |
| `MESSAGE_FILENAME` | The name of the file containing the message |
| `MESSAGE_TIMESTAMP` | The timestamp of the message, in ms from the epoch, including fractional part, e.g. `1685412652205.3308` |
| `MESSAGE_TIMESTAMP_S` | The timestamp of the message, in seconds from the epoch, excluding the fractional part, e.g. `1685412652` |
| `MESSAGE_PRIORITY` | The `priority` field from the message, if available |
| `MESSAGE_PRIORITY_SLOT` | The `priority_slot` field from the message, if available |
| `MESSAGE_WAS_PRIORITISED` | Set to 1 if the message came from the priority queue, empty otherwise. Note that messages with a `priority_slot` which were demoted to the default queue will *not* have this set. |

Note that while the priority fields are available to the letterhead generator, setting them has no impact as the letterhead is only generated once the message has already made it to the head of the queue and is ready to be published.

Failing to obtain the letterhead will result in a failure to publish the message.

## Message subscription

In addition to allowing other applications to publish messages, chariotd supports subscribing to topics and passing received messages through to other applications. Two mechanisms are provided:

  - Write each message to a given path (such as a named pipe).
  - Run a command for each message and hand the process the message via stdin.

To write received message somewhere, use the command line option `--subscribe-write=TOPIC:/path/to/write/to`. When used, `TOPIC` will be subscribed to and whenever a message is received, `/path/to/write/to` is opened in write-only, non-blocking mode before having the message written and the file descriptor closed again. Any error during either of those steps will result in a warning in the log and the loss of the message.

To hand received messages over to a sub-process, use the command line option `--subscribe-exec=TOPIC:/path/to/command`. When used, `TOPIC` will be subscribed to and whenever a message is received, `/path/to/command` will be executed and passed the message on its stdin. Note that in order to avoid what might otherwise amount to a [fork bomb](https://en.wikipedia.org/wiki/Fork_bomb) the running of the command is done synchronously, ensuring only a single command is run at any one time. While this may slow down message processing, it is deemed the lesser evil. However, the handling command is run with a strict timeout of 5 seconds to avoid leaving chariotd waiting for too long. Errors will result in a warning in the log and the loss of the message.


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

#### open-tunnel

Parameters: JSON object

```
{
  "thing": "YourThingName",
  "region": "xx-xyzzy-n",
  "services": [ "Service1", ... ],
  "token": "AQGAAXiZyfA6..."
}
```

Requests chariotd to launch a new proxy client instance using the provided settings.

If chariotd was started without a `--tunnelmappings` option for this thing, or if the tunnel request's services list does not match the tunnel session, the open-tunnel command will fail.

#### close-tunnel

Parameters: JSON object

```
{
  "thing": "YourThingName"
}
```

Causes chariotd to shut down the active tunnel for the specified thing, provided it had launched the proxy client already. Otherwise a no-op.


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

## Secure Tunneling

For those wishing to use the AWS IoT Secure Tunneling feature, chariotd provides easy integration when using the [AWS IoT Secure Tunneling local proxy](https://github.com/aws-samples/aws-iot-securetunneling-localproxy). A different proxy client may be used as long as it provides the same interface in terms of environment variables and command line options. If the tunnel proxy client isn't called `localproxy` or is not in the path it must be explicitly specified using `--tunnelproxy=/path/to/proxyclient`.

When opening a tunnel session for a thing, the access token is sent to the device automatically on a reserved MQTT topic. When chariotd receives a message on such a topic it will spawn a proxy client, providing the access token (and other details). Note that AWS IoT sends the access token only *once*. If the device is not online at the time, the token may be lost. If this is a concern, you could provide an additional way of providing it to the device, and issue an explicit open-tunnel command to chariotd. See the [open-tunnel description](#open-tunnel) for details. One idea would be to provide the tunnel details via the device shadow, and implement a service which issues the open-tunnel/close-tunnel commands.

If a new tunnel request is received for a thing, chariotd will terminate the previous proxy instance, if known. Proxy clients are run "backgrounded" so they may outlive the chariotd instance. If chariotd has been restarted and receives a new tunnel request for which there is an old proxy client running, chariotd will be unable to terminate the old proxy client instance. Likewise it will not be able to action [close-tunnel commands](#close-tunnel) for it.


### Tunnel port mappings

To enable secure tunneling for a device, one or more service names must be mapped to a port number. The trivial case is a single service, e.g. "SSH=22". Multiple port mappings are specified separated by a comma, e.g. "SSH=22,HTTPS=443". The service names are arbitrary, but must match what is used in the tunnel setup.

Worth noting is that it is perfectly valid to provide more port mappings to chariotd than what ends up used in a tunnel session. When invoking the proxy client, chariotd will only pass the services actually requested in the tunnel session.

### Local proxy CA requirements

The standard local proxy client expects the Amazon root CA certificate to be available in a manner OpenSSL understands. On many systems it may already be available in a default location, in which case no special attention is required.

If that is not the case, then the CA certificate must be provided in a directory which has been set up to be OpenSSL compatible. Please refer to the [localproxy documentation](https://github.com/aws-samples/aws-iot-securetunneling-localproxy#certificate-setup) on how to prepare such a directory, and then pass `--tunnelcadir=/path/to/ca-dir` to chariotd on startup.

### Using a different local proxy client

If using a proxy client other than the AWS reference implementation, the following interface must be compatible. If necessary, use a wrapper shell script to translate as needed.

Environment variables:
  - `AWSIOT_TUNNEL_REGION` - The region string, e.g. 'ap-southeast-2'.
  - `AWSIOT_TUNNEL_ACCESS_TOKEN` - The destination access token.

Command line options:
  - `-d SVC1=PORT2,SVC2=PORT2...` - One or more mappings between service name and port.
  - `-c CADIR` - Root CA certificate directory. Only used if `--tunnelcadir` is passed to chariotd.

