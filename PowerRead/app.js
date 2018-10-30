var amqp = require('amqplib/callback_api');
const axios = require('axios');
const Gpio = require('onoff').Gpio;

// #region init

var pins = [];
const nodeId = process.env.NODE_ID;
const server_url = process.env.SERVER_URL;

console.log('Initializing node: ', nodeId);

initializeApp();

console.log('Initialized');

function initializeApp() {
    axios.get(`http://${server_url}/api/NodePin/node/${nodeId}/read`)
        .then(function (response) {
            console.log('Initial data:' + response.data);
            response.data.forEach(function (nodePin) {
                pins.push({ gpio: selectWatcher(nodePin), status: 0 });
                const _status = pins.filter(x => x.gpio._gpio === nodePin)[0].gpio.readSync();
                pins.filter(x => x.gpio._gpio === nodePin)[0].status = _status;
                sendToRmq({
                    id: nodePin,
                    status: _status === 1 ? true : false,
                    service: 'Power_Read',
                    nodeId: nodeId
                });
                watcherStart(pins.filter(x => x.gpio._gpio === nodePin)[0].gpio);
                console.log('Initialized Read');
            });
        })
        .catch(function (error) {
            console.log('=-==-==-=-==-=-==-=-= Error while starting Reading =-==-==-=-==-=-==-=-=' + error);
            throw "No connection with server";
        });
}
// #endregion


function selectWatcher(pin) {
    return new Gpio(pin, 'in', 'both', 'both');
}

function watcherStart(gpio) {
    gpio.watch((err, value) => {
        if (err) {
            throw err;
        }

        console.log(`Pin ${gpio._gpio} changed, New value: ${value}`);
        sendToRmq({
            id: gpio._gpio,
            status: value === 1 ? true : false,
            service: 'Power_Read',
            nodeId: nodeId
        });
    });
}

function sendToRmq(model) {

    const _LastStatus = pins.filter(x => x.gpio._gpio === model.id)[0].status;
    if (model.status === _LastStatus) return;

    pins.filter(x => x.gpio._gpio === model.id)[0].status = model.status;

    var newMsg = JSON.stringify(model);
    amqp.connect(`amqp://${process.env.RMQ_IP}`, function (err, conn) {
        // amqp.connect(`amqp://localhost`, function (err, conn) {
        conn.createChannel(function (err, ch) {
            var q = 'Server';

            ch.assertQueue(q, { durable: false });
            // Note: on Node 6 Buffer.from(msg) should be used
            ch.sendToQueue(q, new Buffer.from(newMsg));
            console.log(" [x] Sent Message to Server:" + newMsg);

            setTimeout(function () { conn.close(); }, 500);
        });
    });
}

// #region Safely closing
function exitHandler(options, err) {
    if (options.cleanup) {
        pins.forEach(x => x.unexport());
    }
    if (err) console.log(err.stack);
    if (options.exit) process.exit();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, { cleanup: true }));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, { exit: true }));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

// #endregion
