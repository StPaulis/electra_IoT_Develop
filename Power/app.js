const amqp = require('amqp-connection-manager');
const axios = require('axios');
var Gpio = require('onoff').Gpio;
const storage = require('node-persist');

const NODE_ID = process.env.NODE_ID || 7;
const SERVER_URL = process.env.SERVER_URL || '188.166.27.17:2853';
const DEVICE_NAME = process.env.DEVICE_NAME || 'ControlPowerWithAzure';
const RMQ_IP = process.env.RMQ_IP || 'localhost';
const IS_PROD = process.env.IS_PROD || false;
const RELAY_DELAY = parseInt(process.env.Relay_Delay_In_Ms) || 100;

let pinReaders = [];
let pinWriters = [];
let relayKastaniasInfoList = [];
let rmqConn = null;

console.log(`[POWER] Initializing Storage...`);
initStorage();
console.log(`[POWER] Storage Initialized!`);

console.log(`[POWER] Initializing power configuration...`);
initPower();
console.log(`[POWER] Power configuration initialized!`);

function initPower() {
  console.log(`[POWER] Receiving info about device Output pins...`);
  axios.post(`http://${SERVER_URL}/api/NodePin/node/write`, {
    id: NODE_ID,
    name: DEVICE_NAME
  }).then(function (response) {
    console.log('[Power] Info about Output pins received: ' + JSON.stringify(response.data));
    response.data.forEach(function (nodePin) {

      console.log('[Power] Setting up pin ' + nodePin.controllerPin + ' as Output...');

      if (IS_PROD) {
        gpio = new Gpio(nodePin.controllerPin, 'out');
      }
      else {
        console.log('[POWER] Virtual Mode is Enabled! Fake pins are set! To change that behavior add \'IS_PROD\' enviroment variable to \'true\'!');
        gpio = {
          writeSync: (value) => {
            console.log(`[POWER] Virtual Pin ${nodePin.controllerPin} is now ${value}`);
          }
        };
      }

      pinWriters.push({
        gpio: gpio,
        pin: nodePin.controllerPin,
        inputPin: nodePin.inputPin,
        status: nodePin.status
      });
      console.log('[Power] Set up pin ' + nodePin.controllerPin + ' as Output!');

      if (nodePin.pinModeId === 4) {
        console.log('[Power] Setting up pin ' + nodePin.controllerPin + ' as Rele Kastanias with status ' + nodePin.status + '...');
        if (relayKastaniasInfoList.some(x => x.pin === nodePin.controllerPin)) {
          relayKastaniasInfoList = relayKastaniasInfoList.filter(x => x.pin !== nodePin.controllerPin);
        }
        relayKastaniasInfoList.push({ pin: nodePin.controllerPin, status: nodePin.status });
        console.log('[Power] Set up pin ' + nodePin.controllerPin + ' as Rele Kastanias with status ' + nodePin.status + '!');
      }

      console.log('[Power] Initializing pin ' + nodePin.controllerPin + ' status: ' + nodePin.status + '...');
      triggerPin(nodePin.status, nodePin.controllerPin);
      console.log('[Power] Pin ' + nodePin.controllerPin + ' initialized with status: ' + nodePin.status + '!');

      console.log('[Power] Get paused jobs from storage for pin ' + nodePin.controllerPin + '...');
      const jobFromStorage = getJobFromStorage(nodePin.controllerPin);
      if (jobFromStorage) {
        const job = JSON.parse(jobFromStorage);
        console.log('[Power] Pin ' + nodePin.controllerPin + ' has a paused job in storage, restoring...');
        const nowInEpoch = Date.now();
        const fireAt = job.time - nowInEpoch;
        setTimeout(() => {
          removeJobFromStorage(nodePin.controllerPin);
          onReceiveFromRmqToWrite(JSON.stringify(
            {
              Id: nodePin.controllerPin,
              Status: job.status,
              ClosedinMilliseconds: 0,
              Service: 'Power_Write:' + NODE_ID.toString(),
              PinModeId: nodePin.pinModeId,
              Expiring: nowInEpoch + 15,
              JobGuid: '00000000-0000-0000-0000-000000000000',
              NodeId: NODE_ID.toString()
            }));
          console.log('[Power] Pin ' + nodePin.controllerPin + ' has a paused jon in storage, restored!');
        }, fireAt > 100 ? fireAt : 100);
      }
      console.log('[Power] Get paused jobs from storage for pin ' + nodePin.controllerPin + ' finished!');
    });
    console.log(`[POWER] Setup for Output pins finished! `);

    initPowerRead();

    console.log('[Power] Create RabbitMq channels and subscribe to listen for messages...');
    subscribeWritersToRMQ();
    console.log('[Power] RabbitMq channels created and is now listening for messages from the router!');
  })
    .catch(function (error) {
      console.log('[Power] Restarting service while setting up Outputs', error);
      exit();
    });

  function initPowerRead() {
    console.log(`[POWER] Receiveing info about device Input pins!`);
    axios.post(`http://${SERVER_URL}/api/NodePin/node/read`, { id: NODE_ID, name: DEVICE_NAME })
      .then(function (response) {
        console.log('[Power] Info about Input pins received: ' + JSON.stringify(response.data));
        response.data.forEach(function (nodePin) {
          console.log('[Power] Setting up pin ' + nodePin + ' as Input...');
          pinReaders.push({
            gpio: createReader(nodePin),
            status: 0,
            pin: nodePin
          });
          console.log('[Power] Set pin ' + nodePin + ' as Input!');

          console.log('[Power] Reading status from device pin ' + nodePin + ' and send to RabbitMq...');
          const _status = pinReaders.find(x => x.pin === nodePin).gpio.readSync();
          pinReaders.find(x => x.pin === nodePin).status = _status;

          onReaderStatusChanged({
            id: nodePin,
            status: _status === 1 ? true : false,
            service: 'Power_Read',
            nodeId: NODE_ID
          });

          watchReader(pinReaders.find(x => x.pin === nodePin).gpio);
          console.log('[Power] Read status from device pin ' + nodePin + ' and sent to RabbitMq!');
        });
      })
      .catch(function (error) {
        console.log('[Power] Restarting service while setting up Inputs: Error: ', error);
        exit();
      });
  }
}

function handleWrite(model) {
  const nodePin = pinWriters.find(x => x.pin == model.Id);
  let responseStatus = model.Status;

  switch (model.PinModeId) {
    case 2: // Output

      const inputStatus = pinReaders.filter(x => x.pin === nodePin.inputPin)[0].status;
      if (inputStatus != model.Status) {
        console.log('[Power] Trigger Button Pin ' + model.Id + ' current status ' + !nodePin.status);
        responseStatus = !nodePin.status;
        triggerPin(responseStatus, model.Id);
      }
      else {
        console.log('[Power] Not Trigger Button Pin ' + model.Id + ' current status ' + nodePin.status);
        responseStatus = nodePin.status;
      }

      break;
    case 3: // Direct

      console.log('[Power] Set Direct Pin ' + model.Id + ' as ' + model.Status);
      triggerPin(model.Status, model.Id);

      break;
    case 4: // Relay Kastanias aka Button

      if (relayKastaniasInfoList.some(x => x.pin == model.Id) === false) {
        console.log('[Power] ERROR! Pin ' + model.Id + ' has not been set as Rele Kastanias!');
        exit();
      }

      responseStatus = relayKastaniasInfoList.find(x => x.pin == model.Id).status;

      const inputStatus = pinReaders.filter(x => x.pin === nodePin.inputPin)[0].status;
      if (inputStatus != model.Status) {
        console.log('[Power] Set Kastania Pin ' + model.Id + ' as ' + !responseStatus);
        triggerPin(!responseStatus, model.Id);

        setTimeout(function () {
          console.log('[Power] Set Kastania Pin ' + model.Id + ' as ' + responseStatus);
          triggerPin(responseStatus, model.Id);
        }, RELAY_DELAY);
      }

      break;
    default:
      break;
  }

  if (model.ClosedinMilliseconds) {
    setJobToStorage(model.Id, Date.now() + model.ClosedinMilliseconds,);
    console.log(`[Power]: Auto Close Set for Pin ${model.Id} to ${!model.Status} in ${model.ClosedinMilliseconds} milliseconds`);
    setTimeout(function () {
      model.Status = !model.Status;
      model.ClosedinMilliseconds = 0;
      console.log(`[Power]: Auto Close Triggered for Pin ${model.Id} to ${model.Status} `);
      removeJobFromStorage(model.Id);
      onReceiveFromRmqToWrite(JSON.stringify(model));
    }, model.ClosedinMilliseconds);
  }

  return responseStatus;
}

function watchReader(gpio) {
  gpio.watch((err, value) => {
    if (err) {
      console.log(err);
      exit();
    }

    console.log(`Pin ${gpio._gpio} changed, New value: ${value}`);
    onReaderStatusChanged({
      id: gpio._gpio,
      status: value === 1 ? true : false,
      service: 'Power_Read',
      nodeId: NODE_ID
    });
  });
}

function createReader(pin) {
  if (IS_PROD) {
    return new Gpio(pin, 'in', 'both', 'both');
  } else {
    let virtualGpio = {
      watch: (err, value) => {
        console.log(`Gpio Pin ${pin} is virtual reader!`);
        return 0;
      },
      readSync: (value) => {
        console.log('Read Sync in virtual mode on pin:' + pin);
      }
    };
    return virtualGpio;
  }
}

function subscribeWritersToRMQ() {
  if (!rmqConn) {
    rmqConn = amqp.connect([`amqp://${RMQ_IP}`]);
  };

  rmqConn.createChannel({
    setup: function (channel) {
      return Promise.all([
        channel.assertQueue(`Power_Write:${NODE_ID}`, {
          durable: false
        }),
        channel.consume(`Power_Write:${NODE_ID}`, function (msg) {
          onReceiveFromRmqToWrite(bin2string(msg.content));
        }, {
          noAck: true
        })
      ]);
    }
  });
}

function onReceiveFromRmqToWrite(msg) {
  var model = JSON.parse(msg);
  var status = false;
  try {
    status = handleWrite(model);
  } catch (error) {
    console.log(error);
    exit();
  }

  model.NodeId = NODE_ID;
  model.Status = status;
  var newMsg = JSON.stringify(model);

  sendToRmq(newMsg);
}

function onReaderStatusChanged(model) {

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
      });
    }
  });

  rmqChannel.sendToQueue('Server', new Buffer.from(msg))
    .then(function () {
      rmqChannel.close();
      return console.log(" [Power] Sent Message to Router:" + msg);
    }).catch(function (err) {
      rmqChannel.close();
      return console.log(" [AMQPv4] Rejected Message to Router:" + msg);
    });
}

function triggerPin(status, id) {
  console.log('[Power] Triggering pin ' + id + ' as ' + status + '...');
  pinWriters.find(x => x.pin === id).gpio.writeSync(status ? 1 : 0);
  pinWriters.find(x => x.pin === id).status = status;
  console.log('[Power] Trigger pin ' + id + ' as ' + status + '!');
}

function bin2string(array) {
  var result = "";
  for (var i = 0; i < array.length; ++i) {
    result += (String.fromCharCode(array[i]));
  }
  return result;
}

function initStorage() {
  storage.initSync({ dir: '../../../data', });
}
function setJobToStorage(pinId, time, status) {
  console.log('setJobToStorage:', pinId, time, status);
  storage.setItemSync(pinId.toString(), JSON.stringify({ time: time, status: status }));
}
function getJobFromStorage(pinId) {
  return storage.getItemSync(pinId.toString());
}
function removeJobFromStorage(pinId) {
  storage.removeItemSync(pinId.toString());
}

// #region Safely closing
function exitHandler(options, err) {
  if (err) console.log(err.stack);
  exit();
}

function exit() {
  if (IS_PROD && pinWriters) {
    pinWriters.forEach(x => x.gpio.unexport());
  }

  pinWriters = [];
  pinReaders = [];
  relayKastaniasInfoList = [];

  if (rmqConn) {
    rmqConn.close();
    rmqConn = null;
  }

  process.exit(1);
}

[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
  process.on(eventType, exitHandler.bind(null, { exit: true }, { stack: eventType }));
});
// #endregion