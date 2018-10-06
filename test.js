require('dotenv').load(); // TODO uninstall this

const { TwilioController } = require('./dist');

const tc = new TwilioController({
  accountSid: process.env.ACCOUNT_SID,
  authToken: process.env.AUTH_TOKEN,
  messageServiceId: process.env.MESSAGE_SERVICE_ID,
});

tc.sendTextMessage(process.env.DEV_PHONE_NUMBER, 'Testing again');
