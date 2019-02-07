var amqp = require('amqplib/callback_api');

const RMQ_IP = process.env.RMQ_IP || '192.168.1.30';
const DEVICE_NAME = process.env.DEVICE_NAME || 'ControlPowerWithAzure';
const RMQ_IPV6 = process.env.RMQ_IPV6 || '192.168.1.10';
const RMQ_PASSWORD = process.env.RMQ_PASSWORD || 'gest';
const RMQ_USERNAME = process.env.RMQ_USERNAME || 'gest';
const amqv6Options = {
  protocol: 'amqp',
  hostname: RMQ_IPV6,
  port: 5672,
  username: RMQ_USERNAME,
  password: RMQ_PASSWORD,
  heartbeat: 5,
  vhost: '/'
};

process.on('uncaughtException', err => {
  console.error('UnCaught', err);
  setTimeout(function() {
    watchCloud();
    watchHome();
  }, 5000);
});

watchCloud();
watchHome();

function watchCloud() {
  try {
    amqp.connect(amqv6Options, function(err, conn) {
      setTimeout(function() {
        handleError(err, conn, watchCloud);
      }, 5000);
      if (conn) {
        conn.createChannel(function(err, ch) {
          var q = DEVICE_NAME;

          ch.assertQueue(q, {
            durable: true
          });
          ch.prefetch(1);
          ch.consume(
            q,
            function(msg) {
              const bufferedData = msg.content;
              let model = JSON.parse(bin2string(bufferedData));
              if (
                model.Expiring &&
                Math.floor(Date.now() / 1000) < +model.Expiring
              ) {
                console.log(
                  '[From Cloud To Router]:' + bin2string(bufferedData)
                );
                sendToHome(bin2string(bufferedData));
              } else {
                console.log(
                  `[Error] Job is late || (Now: ${Math.floor(
                    Date.now() / 1000
                  )} > Expiring: ${+model.Expiring})`
                );
              }
            },
            {
              noAck: true
            }
          );
        });
      } else {
        conn.close();
        setTimeout(function() {
          watchCloud();
        }, 5000);
      }
    });
  } catch (error) {
    console.error('Catch on cloud consumer', error.message);
    setTimeout(function() {
      watchCloud();
    }, 5000);
  }
}

function watchHome() {
  try {
    amqp.connect(`amqp://${RMQ_IP}`, function(err, conn) {
      setTimeout(function() {
        handleError(err, conn, watchHome);
      }, 5000);
      if (conn) {
        conn.createChannel(function(err, ch) {
          var q = 'Server';

          ch.assertQueue(q, {
            durable: false
          });
          // Note: on Node 6 Buffer.from(msg) should be used
          ch.consume(
            q,
            function(msg) {
              console.log(
                ' [Received To Router from Home] %s',
                msg.content.toString()
              );
              SendToCloud(msg.content);
            },
            {
              noAck: true
            }
          );
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    setTimeout(function() {
      watchHome();
    }, 5000);
  }
}

// Helpers
function SendToCloud(bytes) {
  amqp.connect(`amqp://${RMQ_USERNAME}:${RMQ_PASSWORD}@${RMQ_IPV6}`, function(
    err,
    conn
  ) {
    conn.createChannel(function(err, ch) {
      var q = 'Cloud';

      ch.assertQueue(q, {
        durable: true
      });
      ch.sendToQueue(q, new Buffer(bytes), {
        persistent: true
      });
      console.log(" [Sent to Cloud] Sent '%s'", bytes);
    });

    setTimeout(function() {
      conn.close();
    }, 500);
  });
}

function sendToHome(msg) {
  amqp.connect(`amqp://${RMQ_IP}`, function(err, conn) {
    conn.createChannel(function(err, ch) {
      var q = '';

      try {
        q = JSON.parse(msg).Service;
      } catch (error) {
        console.log(error);
      }

      ch.assertQueue(q, {
        durable: false
      });
      // Note: on Node 6 Buffer.from(msg) should be used
      ch.sendToQueue(q, new Buffer.from(msg));
      console.log(`[Router to Home] Sent '${msg}' to ${q}:`);

      setTimeout(function() {
        conn.close();
      }, 500);
    });
  });
}

function handleError(err, conn, watchCallback) {
  // if (err) {
  //   console.error('[AMQP ERROR]', err.message);
  //   setTimeout(function() {
  //     conn.close();
  //     watchCallback;
  //   }, 10000);
  // }

  // if (conn) {
  //   conn.on('error', function(err) {
  //     if (err.message !== 'Connection closing') {
  //       console.error('[AMQP ERROR] conn error', err.message);
  //     }
  //   });
  //   try {
  //     conn.on('close', function() {
  //       console.error('[AMQP ERROR] reconnecting');
  //       setTimeout(function() {
  //         conn.close();
  //         watchCallback;
  //       }, 10000);
  //     });
  //   } catch (error) {}
  // }
}

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
