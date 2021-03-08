const amqp = require('amqp-connection-manager');
const axios = require('axios');
var Gpio = require('onoff').Gpio;
const storage = require('node-persist');

const nodeId = process.env.NODE_ID || 7;
const server_url = process.env.SERVER_URL || '188.166.27.17:2853';
const RMQ_IP = process.env.RMQ_IP || 'localhost';
const IS_PROD = process.env.IS_PROD || false;
const Relay_Delay = parseInt(process.env.Relay_Delay_In_Ms) || 100;

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
  axios.get(`http://${server_url}/api/NodePin/node/${nodeId}/write`)
    .then(function (response) {
      console.log('[Power] Info about Output pins received: ' + JSON.stringify(response.data));
      response.data.forEach(function (nodePin) {

        console.log('[Power] Setting up pin ' + nodePin.controllerPin + ' as Output...');
        if (IS_PROD) {
          pinWriters.push({
            gpio: new Gpio(nodePin.controllerPin, 'out'),
            pin: nodePin.controllerPin
          });
        } else {
          console.log('[POWER] Virtual Mode is Enabled! Fake pins are set! To change that behavior add \'IS_PROD\' enviroment variable to \'true\'!');
          let virtualGpio = {
            writeSync: (value) => {
              console.log(`[POWER] Virtual Pin ${nodePin.controllerPin} is now ${value}`);
            }
          };

          pinWriters.push({
            gpio: virtualGpio,
            pin: nodePin.controllerPin
          });
        }
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
        blink(nodePin.status, nodePin.controllerPin);
        console.log('[Power] Pin ' + nodePin.controllerPin + ' initialized with status: ' + nodePin.status + '!');

        console.log('[Power] Get paused jobs from storage for pin ' + nodePin.controllerPin + '...');
        const jobFromStorage = getJobFromStorage(nodePin.controllerPin);
        if (jobFromStorage) {
          const job = JSON.parse(jobFromStorage);
          console.log('[Power] Pin ' + nodePin.controllerPin + ' has a paused jon in storage, restoring...');
          const nowInEpoch = Date.now();
          const fireAt = job.time - nowInEpoch;
          setTimeout(() => {
            removeJobFromStorage(nodePin.controllerPin);
            receiveFromRmqToWrite(JSON.stringify(
              {
                Id: nodePin.controllerPin,
                Status: job.status,
                ClosedinMilliseconds: 0,
                Service: 'Power_Write:' + nodeId.toString(),
                PinModeId: nodePin.pinModeId,
                Expiring: nowInEpoch + 15,
                JobGuid: '00000000-0000-0000-0000-000000000000',
                NodeId: nodeId.toString()
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
    axios.get(`http://${server_url}/api/NodePin/node/${nodeId}/read`)
      .then(function (response) {
        console.log('[Power] Info about Input pins received: ' + JSON.stringify(response.data));
        response.data.forEach(function (nodePin) {
          console.log('[Power] Setting up pin ' + nodePin + ' as Input...');
          pinReaders.push({
            gpio: getGpioReader(nodePin),
            status: 0,
            pin: nodePin
          });
          console.log('[Power] Set pin ' + nodePin + ' as Input!');

          console.log('[Power] Reading status from device pin ' + nodePin + ' and send to RabbitMq...');
          const _status = pinReaders.find(x => x.pin === nodePin).gpio.readSync();
          pinReaders.find(x => x.pin === nodePin).status = _status;

          changeStatusAndSendToRmq({
            id: nodePin,
            status: _status === 1 ? true : false,
            service: 'Power_Read',
            nodeId: nodeId
          });

          initGpioReader(pinReaders.find(x => x.pin === nodePin).gpio);
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
  if (model.PinModeId === 4) {
    if (relayKastaniasInfoList.some(x => x.pin == model.Id) === false) {
      console.log('[Power] ERROR! Pin ' + model.Id + ' has not been set as Rele Kastanias!');
      exit();
    }
    var releStatus = relayKastaniasInfoList.find(x => x.pin == model.Id).status;
    console.log('[Power] Set Kastania Pin ' + model.Id + ' as ' + !releStatus);
    blink(!releStatus, model.Id);

    setTimeout(function () {
      console.log('[Power] Set Kastania Pin ' + model.Id + ' as ' + releStatus);
      blink(releStatus, model.Id);
    }, Relay_Delay);

  } else {
    console.log('[Power] Set Pin ' + model.Id + ' as ' + model.Status);
    blink(model.Status, model.Id);
  }

  if (model.ClosedinMilliseconds) {
    setJobToStorage(model.Id, Date.now() + model.ClosedinMilliseconds, !model.Status);
    console.log(`[Power]: Auto Close Set for Pin ${model.Id} to ${!model.Status} in ${model.ClosedinMilliseconds} milliseconds`);
    setTimeout(function () {
      model.Status = !model.Status;
      model.ClosedinMilliseconds = 0;
      console.log(`[Power]: Auto Close Triggered for Pin ${model.Id} to ${!model.Status} `);
      removeJobFromStorage(model.Id);
      receiveFromRmqToWrite(JSON.stringify(model));
    }, model.ClosedinMilliseconds);
  }
}

function initGpioReader(gpio) {
  gpio.watch((err, value) => {
    if (err) {
      console.log(err);
      exit();
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
        console.log('Read Sync in virtual mode on pin:' + pin);
      }
    };
    return virtualGpio;
  }
}

function subscribeWritersToRMQ() {
  if (!rmqConn) {
    rmqConn = amqp.connect([`amqp://${RMQ_IP}`], {

    });
  };

  rmqConn.createChannel({
    setup: function (channel) {
      return Promise.all([
        channel.assertQueue(`Power_Write:${nodeId}`, {
          durable: false
        }),
        channel.consume(`Power_Write:${nodeId}`, function (msg) {
          receiveFromRmqToWrite(bin2string(msg.content));
        }, {
          noAck: true
        })
      ]);
    }
  });
}

function receiveFromRmqToWrite(msg) {
  var model = JSON.parse(msg);

  try {
    handleWrite(model);
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

function blink(status, id) {
  console.log('[Power] Triggering pin ' + id + ' as ' + status + '...');
  pinWriters.find(x => x.pin === id).gpio.writeSync(status ? 1 : 0);
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
  if (IS_PROD) {
    pinWriters.forEach(x => x.gpio.unexport());
    pinWriters = [];
    pinReaders = [];
    relayKastaniasInfoList = [];
  }
  if (err) console.log(err.stack);
  exit();
}

function exit() {
  if (IS_PROD && pinWriters) {
    pinWriters.forEach(x => x.gpio.unexport());
  }

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