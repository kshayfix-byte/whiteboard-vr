const express = require('express');
const port = process.env.PORT || 3000;
const app = express();
const fs = require('fs');
const http = require('https').createServer({
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem'),
    passphrase: process.env.SSL_PASSPHRASE || 'marlon'
}, app);
const io = require('socket.io')(http);
const { setup } = require('./lib/realtime');

setup(app, io);

http.listen(port, () => {
  console.log('server running at :' + port);
});
