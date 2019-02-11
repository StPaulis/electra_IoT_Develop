const amqp = require('amqp-connection-manager');
const axios = require('axios');
var Gpio = require('onoff').Gpio;

const nodeId = process.env.NODE_ID || 7;
const server_url = process.env.SERVER_URL || 'localhost:2853';
const RMQ_IP = process.env.RMQ_IP || 'localhost'
const IS_PROD = process.env.IS_PROD || false;
var pinReaders = [];
var pinWriters = [];
let boilerStatus = true;
let rmqConn = null;

initPower();

function initPower() {
  axios.get(`http://${server_url}/api/NodePin/node/${nodeId}/write`)
    .then(function (response) {
      console.log('[Power Write] Init:' + JSON.stringify(response.data));
      response.data.forEach(function (nodePin) {

        if (IS_PROD) {
          pinWriters.push({
            gpio: new Gpio(nodePin.controllerPin, 'out'),
            pin: nodePin.controllerPin
          });
        } else {

          let virtualGpio = {
            writeSync: (value) => {
              console.log(`Virtual Pin ${nodePin.controllerPin} is now ${value}`);
            }
          };

          pinWriters.push({
            gpio: virtualGpio,
            pin: nodePin.controllerPin
          });
        }
        if (nodePin.pinModeId === 4) {
          boilerStatus = nodePin.status;
        }
        blink(nodePin.status, nodePin.controllerPin);
      });
      initPowerRead();
      subscribeWritersToRMQ();
    })
    .catch(function (error) {
      console.log('[Power Write] Restarting service on init' + error);
      initPower();
    });

  function initPowerRead() {

    axios.get(`http://${server_url}/api/NodePin/node/${nodeId}/read`)
      .then(function (response) {
        console.log('[Power Read] Init:' + JSON.stringify(response.data));
        response.data.forEach(function (nodePin) {
          pinReaders.push({
            gpio: getGpioReader(nodePin),
            status: 0,
            pin: nodePin
          });

          const _status = pinReaders.find(x => x.pin === nodePin).gpio.readSync();
          pinReaders.find(x => x.pin === nodePin).status = _status;

          changeStatusAndSendToRmq({
            id: nodePin,
            status: _status === 1 ? true : false,
            service: 'Power_Read',
            nodeId: nodeId
          });

          initGpioReader(pinReaders.find(x => x.pin === nodePin).gpio);
        });
      })
      .catch(function (error) {
        console.log('[Power Read] Restarting service on init' + error);
        initPowerRead();
      });
  }
}

function initGpioWriter(model) {
  if (model.PinModeId === 4) {
    blink(!boilerStatus, model.Id);

    setTimeout(function () {
      blink(boilerStatus, model.Id);
    }, 100);

  } else {
    blink(model.Status, model.Id);
  }
}

function initGpioReader(gpio) {
  gpio.watch((err, value) => {
    if (err) {
      console.log(err);
      exit()
    }

    console.log(`Pin ${gpio._gpio} changed, New value: ${value}`);
    changeStatusAndSendToRmq({
      id: gpio._gpio,
      status: value === 1 ? true : false,
      service: 'Power_Read',
      nodeId: nodeId
    });
  });
}

function getGpioReader(pin) {
  if (IS_PROD) {
    return new Gpio(pin, 'in', 'both', 'both');
  } else {
    let virtualGpio = {
      watch: (err, value) => {
        console.log(`Gpio Pin ${pin} is virtual reader!`);
        return 0;
      },
      readSync: (value) => {
        console.log('Read Sync in virtual mode on pin:' + pin)
      }
    };
    return virtualGpio;
  }
}

function subscribeWritersToRMQ() {
  if (!rmqConn) {
    rmqConn = amqp.connect([`amqp://${RMQ_IP}`])
  };

  rmqConn.createChannel({
    setup: function (channel) {
      return Promise.all([
        channel.assertQueue(`Power_Write:${nodeId}`, {
          durable: false
        }),
        channel.consume(`Power_Write:${nodeId}`, function (msg) {
          receiveFromRmqToWrite(bin2string(msg.content))
        }, {
          noAck: true
        })
      ])
    }
  });
}

function receiveFromRmqToWrite(msg) {
  var model = JSON.parse(msg);

  try {
    initGpioWriter(model);
  } catch (error) {
    console.log(error);
    exit();
  }

  model.NodeId = nodeId;
  var newMsg = JSON.stringify(model);

  sendToRmq(newMsg);
}

function changeStatusAndSendToRmq(model) {

  const _LastStatus = pinReaders.filter(x => x.pin === model.id)[0].status;
  if (model.status === _LastStatus) return;

  pinReaders.filter(x => x.pin === model.id)[0].status = model.status;

  var newMsg = JSON.stringify(model);
  sendToRmq(newMsg);
}

function sendToRmq(msg) {
  let rmqChannel = rmqConn.createChannel({
    setup: function (channel) {
      return channel.assertQueue('Server', {
        durable: false
      })
    }
  });

  rmqChannel.sendToQueue('Server', new Buffer.from(msg))
    .then(function () {
      rmqChannel.close();
      return console.log(" [AMQPv4] Sent Message to Home Server:" + msg);
    }).catch(function (err) {
      rmqChannel.close();
      return console.log(" [AMQPv4] Rejected Message to Home Server:" + msg);
    });
}

function blink(status, id) {
  pinWriters.find(x => x.pin === id).gpio.writeSync(status ? 1 : 0);
}

function bin2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += (String.fromCharCode(array[i]));
  }
  return result;
}

// #region Safely closing
function exitHandler(options, err) {
  if (options.cleanup && IS_PROD) {
    pinWriters.forEach(x => x.gpio.unexport());
    pinWriters = [];
  }
  if (err) console.log(err.stack);
  if (options.exit) exit();
}

function exit() {
  if (IS_PROD && pinWriters) {
    pinWriters.forEach(x => x.gpio.unexport());
  }

  if (rmqConn) {
    rmqConn.close();
    rmqConn = null;
  }

  initPower();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {
  cleanup: true
}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
  exit: true
}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {
  exit: true
}));
process.on('SIGUSR2', exitHandler.bind(null, {
  exit: true
}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
  exit: true
}));

// #endregion