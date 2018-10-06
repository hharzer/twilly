require('dotenv').load(); // TODO uninstall this

const { twilly } = require('./dist');

// TODO uninstall these
const app = require('express')();
const bp = require('body-parser');

app.use(require('morgan')('dev'));
app.use(bp.urlencoded({ extended: false, limit: '2mb' }));
app.use(bp.json({ limit: '5mb' }));

app.use('/twilly', twilly({
  accountSid: process.env.ACCOUNT_SID,
  authToken: process.env.AUTH_TOKEN,
  messageServiceId: process.env.MESSAGE_SERVICE_ID,

  inboundMessagePath: '/sms',
}));
app.get('/', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.send('<html><body>Hello world!</body></html>')
})

require('http')
  .createServer(app)
  .listen(3000, () => console.log('Listening on port 3000...'));
