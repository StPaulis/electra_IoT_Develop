var rpio = require('rpio'); 
 
rpio.open(7, rpio.OUTPUT, rpio.LOW); 
 
var status = false; 
 
function blinkLED() { 
    status ? rpio.open(7, rpio.OUTPUT, rpio.LOW) : rpio.open(7, rpio.OUTPUT, rpio.HIGH);  
    status = !status; 
    console.log(`Pin 7 status: ${status}`) 
} 
 
blinkLED();

setTimeout(blinkLED, 1000);

// #region RMQ
var amqp = require('amqplib/callback_api'); 

amqp.connect(`amqp://${process.env.MONITOR_IP}`, function (err, conn) {
    conn.createChannel(function (err, ch) {
        var q = 'power_write';

        ch.assertQueue(q, { durable: false });
        // Note: on Node 6 Buffer.from(msg) should be used 
        console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
        ch.consume(q, function (msg) {
            blinkLED();
        }, { noAck: true });
    });
});

// #endregion