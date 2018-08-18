var exec = require('child_process').execSync;
const fs = require('fs');

function execString(msg) {
  exec(msg,
    function (error) {
      if (error !== null) {
        console.log('exec error: ' + error);
      }
    });
  console.log(`exec: ${msg}`)
}

function restart() {
  execString('systemctl restart raspotify');
  execString('systemctl enable raspotify');
};

fs.appendFileSync('/etc/default/raspotify', 
`
DEVICE_NAME="${process.env.SPOTIFY_NAME}"
BITRATE="320"
OPTIONS="--username ${process.env.USERNAME} --password ${process.env.PASSWORD}"
`);

restart();
setInterval(restart, 21600000);
