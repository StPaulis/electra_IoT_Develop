var Mqtt = require('azure-iot-device-mqtt').Mqtt;
var DeviceClient = require('azure-iot-device').Client
var Message = require('azure-iot-device').Message;
var amqp = require('amqplib/callback_api');

const RMQ_IP = process.env.RMQ_IP || 'localhost';
const IS_PROD = process.env.IS_PROD || false;
// #region IoT_Hub

var connectionString = IS_PROD ?
  `HostName=${process.env.HUB_URL};DeviceId=${process.env.DEVICE_NAME};SharedAccessKey=${process.env.HUB_KEY}` :
  'HostName=stpaulis.azure-devices.net;DeviceId=ControlPowerWithAzure;SharedAccessKey=qk80e5DcuYSPeGO/Hik8PMDEVWtxeKRpDIP3RFUYYio=';
var client = DeviceClient.fromConnectionString(connectionString, Mqtt);

var connectCallback = function (err) {
  if (err) {
    console.error('Could not connect: ' + err);
  } else {
    console.log('Client connected');

    client.on('message', function (msg) {
      let model = JSON.parse(bin2string(msg.data))
      if (model.Expiring && Math.floor(Date.now() / 1000) < +model.Expiring) {
        send2Rmq(bin2string(msg.data));
      }
      else {
        console.log(`[Error] Job is late || (Now: ${Math.floor(Date.now() / 1000)} > Expiring: ${+model.Expiring})`);
      }
      client.complete(msg, function () {
        console.log('completed');
      });
    });
  }
};

function Send2IotHub(bytes) {
  var message = new Message(bytes);
  client.sendEvent(message, function (err) {
    if (err) console.log(err.toString());
  });
}

client.open(connectCallback);
// #endregion

// #region RabbitMQ

amqp.connect(`amqp://${RMQ_IP}`, function (err, conn) {
  // amqp.connect(`amqp://localhost`, function (err, conn) {
  conn.createChannel(function (err, ch) {
    var q = 'Server';

    ch.assertQueue(q, {
      durable: false
    });
    // Note: on Node 6 Buffer.from(msg) should be used
    ch.consume(q, function (msg) {
      console.log(" [x] Received to Server %s", msg.content.toString());
      Send2IotHub(msg.content);
    }, {
      noAck: true
    });
  });
});

function send2Rmq(msg) {
  amqp.connect(`amqp://${RMQ_IP}`, function (err, conn) {
    // amqp.connect(`amqp://localhost`, function (err, conn) {
    conn.createChannel(function (err, ch) {
      var q = '';

      try {
        q = JSON.parse(msg).Service;
      } catch (error) {
        console.log(error);
      };

      ch.assertQueue(q, {
        durable: false
      });
      // Note: on Node 6 Buffer.from(msg) should be used
      ch.sendToQueue(q, new Buffer.from(msg));
      console.log(`[x] Sent '${msg}' to ${q}:`);

      setTimeout(function () {
        conn.close();
      }, 500);
    });
  });
}
// #endregion

function bin2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += (String.fromCharCode(array[i]));
  }
  return result;
}