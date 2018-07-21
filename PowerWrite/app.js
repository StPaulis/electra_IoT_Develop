var rpio = require('rpio');

rpio.open(7, rpio.OUTPUT, rpio.LOW);

var status = false;

function blinkLED() {
    status ? rpio.open(7, rpio.OUTPUT, rpio.LOW) : rpio.open(7, rpio.OUTPUT, rpio.HIGH); 
    status = !status;
    console.log(`Pin 7 status: ${status}`)
}

setInterval(blinkLED, 5000);