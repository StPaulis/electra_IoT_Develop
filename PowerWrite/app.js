var amqp = require('amqplib/callback_api');
const axios = require('axios');
const Gpio = require('onoff').Gpio;

// #region init

var pins = [];
// const nodeId = 5;
const nodeId = process.env.NODE_ID;

// axios.get(`http://stpaulis-app.azurewebsites.net/api/NodePin/node/${nodeId}/write`)
console.log('Initializing node: ', nodeId);

axios.get(`http://192.168.1.8:2853/api/NodePin/node/${nodeId}/write`)
    .then(function (response) {
        console.log(response.data);
        response.data.forEach(function (nodePin) {
            pins.push(new Gpio(nodePin.controllerPin, 'out'));
            pins.filter(x => x._gpio === nodePin.controllerPin)[0].writeSync(nodePin.status ? 1 : 0);
        });
        init = true;
    })
    .catch(function (error) {
        console.log('Error when started' + error);
    });

console.log('Initialized');
// #endregion

// #region rmq

amqp.connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
    // amqp.connect(`amqp://localhost`, function (err, conn) {
    conn.createChannel(function (err, ch) {
        var q = 'Power_Write';

        ch.assertQueue(q, { durable: false });
        // Note: on Node 6 Buffer.from(msg) should be used 
        console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
        ch.consume(q, function (msg) {
            console.log(" [x] Received to Write %s", msg.content.toString());
            consumer(bin2string(msg.content));
        }, { noAck: true });
    });
});

function consumer(msg) {

    var model = JSON.parse(msg);
    try {
        handlePin(model);
    } catch (error) {
        console.log(error);
        return;
    }
    model.NodeId = nodeId;
    var newMsg = JSON.stringify(model);

    amqp.connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
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

function handlePin(model) {
    if (model.PinModeId === 4) {
        blink(true, model.Id);
        setTimeout(function() { blink(false, model.Id) }, 100);
    } else {
        blink(model.Status, model.Id);
    }
    pins.filter(x => x._gpio === model.Id)[0].writeSync(model.Status ? 1 : 0);
    console.log('Wrote:', model);
}

function blink(status, id) {
    pins.filter(x => x._gpio === id)[0].writeSync(status ? 1 : 0);
}

// #endregion

function bin2string(array) {
    var result = "";
    for (var i = 0; i < array.length; ++i) {
        result += (String.fromCharCode(array[i]));
    }
    return result;
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