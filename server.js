const express = require('express');
const port = process.env.PORT || 3000;
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { setup } = require('./lib/realtime');

setup(app, io);

http.listen(port, () => {
  console.log('server running at :' + port);
});
