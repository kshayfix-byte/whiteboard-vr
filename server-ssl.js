// Kept so `node server-ssl.js` still works. server.js now serves http on
// port 3000 and, when key.pem and cert.pem exist, https on port 3443.
require('./server');
