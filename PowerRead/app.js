var rpio = require('rpio');
var array = [
    3,  5 ,  7,
    11, 13, 15, 
    19, 21, 23, 
    29, 8 , 10,
    12, 16, 18, 
    22, 24, 26, 
    31, 33, 35,
    37, 38, 40,
    36, 32,
];

array.forEach(x => rpio.open(x, rpio.INPUT, rpio.PULL_DOWN));

array.forEach(x => console.log(`Pin ${x} is currently ` + (rpio.read(x) ? 'high' : 'low')));

function readInput(err) {
    if (err) throw err;
    array.forEach(x => console.log(`Pin ${x} is currently: ${rpio.read(x) ? 'high' : 'low'}`));
                        console.log`*       ~      *         ~      *`
}

setInterval(readInput, 3000);