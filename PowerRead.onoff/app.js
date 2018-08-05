const readline = require('readline');
const Gpio = require('onoff').Gpio;
var led;
var inputPin;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Please select the pin you want to watch: ', (answer) => {

    console.log(`You choose: ${answer}`);
    inputPin = selectWatcher(parseInt(answer));
    led = selectHandler(21);
    watcherStart();
    rl.close();
});


function selectWatcher(pin) {
    return new Gpio(pin, 'in', 'both', 'both');
}

function selectHandler(pin) {
	console.log(`Pin 21 (physically 40) will open with your pin`);
    return new Gpio(pin, 'out');
}

function watcherStart() {
    inputPin.watch((err, value) => {
        if (err) {
            throw err;
        }

        console.log(`CHANGED, New value: ${value}`);
        led.writeSync(value);
    });
}

// #region Safely closing
function exitHandler(options, err) {
    if (options.cleanup) {
        led.unexport();
        inputPin.unexport();
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
