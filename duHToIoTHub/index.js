// #region IoT_Hub

var _azureIotDeviceHttp = require('azure-iot-device-http');

var _azureIotDevice = require('azure-iot-device');

// var _callback_api = require('amqplib/callback_api');

var connectionString = `HostName=${process.env.HUB_URL};DeviceId=${process.env.DEVICE_NAME};SharedAccessKey=${process.env.HUB_KEY}`;
var client = _azureIotDeviceHttp.clientFromConnectionString(connectionString);

var connectCallback = function (err) {
  if (err) {
    console.error('Could not connect: ' + err);
  } else {
    console.log('Client connected');
    var message = new _azureIotDevice.Message('some data from my device');
    client.sendEvent(message, function (err) {
      if (err) console.log(err.toString());
    });

    client.on('message', function (msg) {
      //logic
      switch (msg.data) {
        case "spotify_restart":
          console.log("spotify_restart");
          break;
        case "data_get":
          console.log("data_get");
          break;
        case "data_start":
          console.log("data_start");
          break;
        case "data_stop":
          console.log("data_stop");
          break;
        case "read_start":
          console.log("read_start");
          break;
        case "read_stop":
          console.log("read_stop");
          break;
        case "open":
          console.log("open");
          break;
        case "close":
          console.log("close");
        default:
          console.log("...");
      }
      client.complete(msg, function () {
        console.log('completed');
      });
    });
  }
};

client.open(connectCallback);
// #endregion

// #region RabbitMQ
import { connect } from 'amqplib/callback_api';
// #region Send

connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
  conn.createChannel(function (err, ch) {
    var q = 'power_write';

    ch.assertQueue(q, { durable: false });
    // Note: on Node 6 Buffer.from(msg) should be used
    ch.sendToQueue(q, new Buffer.from('Hello World!'));
    console.log(" [x] Sent 'Hello World!'");

    // Note: on Node 6 Buffer.from(msg) should be used
    ch.consume(q, function (msg) {
      console.log(" [x] Received %s", msg.content.toString());
    }, { noAck: true });
  });
  setTimeout(function () { conn.close(); }, 500);
});

function sendMsg(msg) {
  connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
    var q = 'power_write';

    ch.assertQueue(q, { durable: false });
    // Note: on Node 6 Buffer.from(msg) should be used
    ch.sendToQueue(q, new Buffer.from(msg));
    console.log(" [x] Sent Message:" + msg);
  });
}

// // #endregion
// // #endregion

