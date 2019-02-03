var amqp = require('amqplib/callback_api');

const RMQ_IP = process.env.RMQ_IP || 'localhost';
const DEVICE_NAME = process.env.DEVICE_NAME;
const RMQ_IPV6 = process.env.DEVICE_NAME;

watchCloud();
watchHome();

function watchCloud() {
  amqp.connect(`amqp://${RMQ_USERNAME}:${RMQ_PASSWORD}@${RMQ_IPV6}`, function (err, conn) {
    handleError(err, conn, watchCloud);
    try {
      conn.createChannel(function (err, ch) {
        var q = DEVICE_NAME;

        ch.assertQueue(q, {
          durable: true
        });
        ch.prefetch(1);
        ch.consume(q, function (msg) {
          let model = JSON.parse(bin2string(msg.data))
          if (model.Expiring && Math.floor(Date.now() / 1000) < +model.Expiring) {
            console.log('[From Cloud To Router]:' + bin2string(msg.data));
            sendToHome(bin2string(msg.data));
          } else {
            console.log(`[Error] Job is late || (Now: ${Math.floor(Date.now() / 1000)} > Expiring: ${+model.Expiring})`);
          }
        }, {
          noAck: false
        });
      });
    } catch (error) {
      console.log(error);
      watchCloud();
    }
  });
}

function watchHome() {
  amqp.connect(`amqp://${RMQ_IP}`, function (err, conn) {
    handleError(err, conn, watchHome);
    try {
      conn.createChannel(function (err, ch) {
        var q = 'Server';

        ch.assertQueue(q, {
          durable: false
        });
        // Note: on Node 6 Buffer.from(msg) should be used
        ch.consume(q, function (msg) {
          console.log(" [Received To Router from Home] %s", msg.content.toString());
          SendToCloud(msg.content);
        }, {
          noAck: true
        });
      });
    } catch (error) {
      console.log(error);
      watchHome();
    }
  });
}

// Helpers
function SendToCloud(bytes) {
  amqp.connect(`amqp://${RMQ_USERNAME}:${RMQ_PASSWORD}@${RMQ_IPV6}`, function (err, conn) {
    handleError(err, conn, SendToCloud(bytes));
    try {
      conn.createChannel(function (err, ch) {

        var q = 'Cloud';

        ch.assertQueue(q, {
          durable: true
        });
        ch.sendToQueue(q, new Buffer(bytes), {
          persistent: true
        });
        console.log(" [Sent to Cloud] Sent '%s'", bytes);
      });

      setTimeout(function () {
        conn.close();
        process.exit(0)
      }, 500);
    } catch (error) {
      console.log(error);
    }
  });
}

function sendToHome(msg) {
  amqp.connect(`amqp://${RMQ_IP}`, function (err, conn) {
    handleError(err, conn, sendToHome(msg));
    try {
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
        console.log(`[Router to Home] Sent '${msg}' to ${q}:`);

        setTimeout(function () {
          conn.close();
        }, 500);
      });
    } catch (error) {
      console.log(error);
    }
  });
}

function handleError(err, conn, watchCallback) {
  if (err) {
    console.log(err);
    return setTimeout(watchCallback, 1000);
  }

  if (err) {
    console.error("[AMQP]", err.message);
    return setTimeout(watchCallback, 1000);
  }
  conn.on("error", function (err) {
    if (err.message !== "Connection closing") {
      console.error("[AMQP] conn error", err.message);
    }
  });
  conn.on("close", function () {
    console.error("[AMQP] reconnecting");
    return setTimeout(watchCallback, 1000);
  });
}

function bin2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += (String.fromCharCode(array[i]));
  }
  return result;
}