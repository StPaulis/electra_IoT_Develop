var amqp = require('amqp-connection-manager');

const DELAY = 3000;
const RMQ_IP = process.env.RMQ_IP || '192.168.1.30';
const DEVICE_NAME = process.env.DEVICE_NAME || 'ControlPowerWithAzure';
const RMQ_IPV6 = process.env.RMQ_IPV6 || '192.168.1.10';
const RMQ_PASSWORD = process.env.RMQ_PASSWORD || 'gest';
const RMQ_USERNAME = process.env.RMQ_USERNAME || 'gest';

let cloudConn;
let homeConn;

process.on('uncaughtException', err => {
  console.error('UnCaught', err);
  setTimeout(function () {
    watchCloud();
    watchHome();
  }, DELAY);
});


// #region Main() 
watchCloud();
watchHome();
// #endregion

function watchCloud() {
  if (!cloudConn)
    cloudConn = amqp.connect([`amqp://${RMQ_USERNAME}:${RMQ_PASSWORD}@${RMQ_IPV6}`]);
  cloudConn.createChannel({
    setup: function (channel) {
      return Promise.all([
        channel.assertQueue(DEVICE_NAME, {
          durable: true,
          prefetch: 1
        }),
        channel.consume(DEVICE_NAME, function (msg) {
          const bufferedData = msg.content;
          let model = JSON.parse(bin2string(bufferedData));
          if (
            model.Expiring &&
            Math.floor(Date.now() / 1000) < +model.Expiring
          ) {
            console.log('[From Cloud To Router]:' + bin2string(bufferedData));
            sendToHome(bin2string(bufferedData));
          } else {
            console.log(
              `[Error] Job is late || (Now: ${Math.floor(
                Date.now() / 1000
              )} > Expiring: ${+model.Expiring})`
            );
          }
        }, {
          noAck: true
        })
      ])
    }
  });
}

function watchHome() {
  if (!homeConn)
    homeConn = amqp.connect([`amqp://guest:guest@${RMQ_IP}`]);
  homeConn.createChannel({
    setup: function (channel) {
      return Promise.all([
        channel.assertQueue('Server', {
          durable: false
        }),
        channel.consume('Server', function (msg) {
          console.log(
            ' [Received To Router from Home] %s',
            msg.content.toString()
          );
          SendToCloud(msg.content);
        }, {
          noAck: true
        })
      ])
    }
  });
}

function SendToCloud(bytes) {
  let cloudChannel = cloudConn.createChannel({
    setup: function (channel) {
      return channel.assertQueue('Cloud', {
        durable: true
      })
    }
  });

  cloudChannel.sendToQueue('Cloud', bytes, {
      persistent: true
    })
    .then(function () {
      cloudChannel.close();
      return console.log(" [Sent to Cloud] Sent '%s'", bytes);
    }).catch(function (err) {
      cloudChannel.close();
      return console.log(" [Sent to Cloud] Rejected '%s'", bytes);
    });
}

function sendToHome(msg) {
  try {
    q = JSON.parse(msg).Service;
  } catch (error) {
    console.log(error);
  }

  let homeChannel = homeConn.createChannel({
    setup: function (channel) {
      return channel.assertQueue(q, {
        durable: false
      })
    }
  });

  homeChannel.sendToQueue(q, new Buffer.from(msg))
    .then(function () {
      homeChannel.close();
      return console.log(`[Router to Home] Sent '${msg}' to ${q}:`);
    }).catch(function (err) {
      homeChannel.close();
      return console.log(`[Router to Home] Rejected '${msg}' to ${q}:`);
    });
}

// Helpers
function bin2string(array) {
  var result = '';

  if (array) {
    for (var i = 0; i < array.length; ++i) {
      result += String.fromCharCode(array[i]);
    }
  } else {
    result = '{}';
  }

  return result;
}