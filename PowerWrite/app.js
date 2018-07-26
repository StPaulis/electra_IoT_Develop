const Gpio = require('onoff').Gpio;
const led = new Gpio(17, 'out');

var status = 0;

function blinkLED17() {
    if (status = 0) {
        led.writeSync(1);
        status = 1;
    } else {
        led.writeSync(0);
        status = 0;
    }

    console.log(`Pin 17 status: ${status}`)
}

blinkLED17();

setTimeout(blinkLED17, 1000);

// #region RMQ

amqp.connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
    conn.createChannel(function (err, ch) {
        var q = 'power_write';

        ch.assertQueue(q, { durable: false });
        // Note: on Node 6 Buffer.from(msg) should be used 
        console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
        ch.consume(q, function (msg) {
            blinkLED17();
        }, { noAck: true });
    });
});

// function handleCommand(msg) {
//         blinkLED17();
// }

// #endregion