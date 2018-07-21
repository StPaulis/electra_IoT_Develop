var axios = require('axios');

setInterval(function dealWithApi() {
  axios.get(`http://${process.env.MONITOR_IP}:60080/values`)
    .then(function (response) {
      console.log(response);
    })
    .catch(function () {
      console.log('error getting values from monitor');
    });
}, 10000);