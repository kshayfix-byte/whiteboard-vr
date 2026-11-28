// Starts the whiteboard server.
//
// - http://<this computer>:3000 always (PORT changes it). Browsers on a
//   computer or phone can use this, but VR needs a secure page.
// - https://<this computer>:3443 as well, when key.pem and cert.pem are in the
//   project folder (HTTPS_PORT changes it). Use this address in a headset.
//   Make the two files once with `npm run cert`.
//
// Both addresses share one set of boards and one Socket.io server, so people
// on either can draw together.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { setup } = require('./lib/realtime');

const port = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);
const keyFile = process.env.SSL_KEY || path.join(__dirname, 'key.pem');
const certFile = process.env.SSL_CERT || path.join(__dirname, 'cert.pem');

const app = express();
const httpServer = require('http').createServer(app);
const io = require('socket.io')(httpServer);

let httpsServer = null;
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  try {
    httpsServer = require('https').createServer({
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
      // Only needed for a key made with a passphrase (the old instructions).
      passphrase: process.env.SSL_PASSPHRASE || undefined
    }, app);
    io.attach(httpsServer);
  } catch (err) {
    console.error('HTTPS is off: could not use key.pem / cert.pem (' + err.message + ').');
    console.error('If the key has a passphrase, start with SSL_PASSPHRASE=<passphrase>, or run `npm run cert` to make new files.');
    httpsServer = null;
  }
}

setup(app, io);

// This computer's network addresses, for the start-up message.
function lanAddresses() {
  const found = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) found.push(net.address);
    });
  });
  return found.length ? found : ['localhost'];
}

httpServer.listen(port, () => {
  const hosts = lanAddresses();
  console.log('Whiteboard server running.');
  console.log('  Computer / phone (no VR):  ' + hosts.map((h) => 'http://' + h + ':' + port).join('  '));
  if (!httpsServer) {
    console.log('  Headsets: HTTPS is off. Run `npm run cert` once, then restart, to get an https:// address.');
    console.log('  (Opening https:// on port ' + port + ' gives ERR_SSL_PROTOCOL_ERROR: that port is plain http.)');
  }
});

if (httpsServer) {
  httpsServer.listen(httpsPort, () => {
    const hosts = lanAddresses();
    console.log('  Headsets / VR (https):     ' + hosts.map((h) => 'https://' + h + ':' + httpsPort).join('  '));
    console.log('  The certificate is self-signed: accept the browser warning once on each device.');
  });
}
