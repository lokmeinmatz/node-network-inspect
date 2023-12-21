# @lokmeinmatz/node-network-inspect

This is a Node.js package designed to inspect network activities. It provides a simple API to monitor outgoing HTTP and HTTPS requests and their responses.

## Installation

You can install this package via npm:

```bash
npm install @lokmeinmatz/node-network-inspect
```

## Usage

After installation, you can import the package in your project:

```javascript
const netInspect = require('@lokmeinmatz/node-network-inspect');
```

or 
```javascript
import netInspect from '@lokmeinmatz/node-network-inspect';
```

Here is a basic usage example:

```javascript
const netInspect = require('@lokmeinmatz/node-network-inspect');

const session = netInspect.start({
  logger: {
    debug: () => {},
    log: console.log,
    warn: console.warn,
    error: console.error,
  },
  emitModes: [netInspect.EmitMode.LogSummary]
});

async function main() {
  // make http request to google.com
  const http = require('http');
  console.log('http request to google.com');
  await new Promise((resolve, reject) => {
    http.get('http://google.com', (res) => {
      console.log('statusCode:', res.statusCode);
      res.on('data', (d) => {
        console.log('data len', d.length);
      });
      resolve();
    }).on('error', (e) => {
      console.error(e);
      reject(e);
    });
  });
  // make https request to google.com
  const https = require('https');
  console.log('https request to google.com');
  await new Promise((resolve, reject) => {
    https.get('https://google.com', (res) => {
      console.log('statusCode:', res.statusCode);
      res.on('data', (d) => {
        console.log('data len', d.length);
      });
      resolve();
    }).on('error', (e) => {
      console.error(e);
      reject(e);
    });
  });
}

main();
```

## EmitMode

EmitMode is an enumeration defined in `src/RequestTracker.ts`. It specifies the mode in which the RequestTracker emits events. The possible values are:

**EmitMode.DiagnosticsChannel**: If this mode is set, the RequestTracker emits events to the diagnostics channel. This is useful for collecting detailed diagnostics information about the requests.

**EmitMode.LogFull**: If this mode is set, the RequestTracker logs the full details of the events. This is useful for debugging and understanding the complete lifecycle of the requests.

**EmitMode.LogSummary**: If this mode is set, the RequestTracker logs a summary of the events. This is useful for getting a high-level overview of the requests without the detailed information.


## Testing

This package comes with a basic requirements test. You can run it with npm:

```bash
npm run test
```

The test file `tests/basic_reqs.js` contains more examples of how to use the API.

## Building

To build this project, run the `build` script in the `package.json` file:

```bash
npm run build
```

## License

This package is licensed under the ISC license.