# BluetoothSensorMonitor

This project acts as a driver for reading/writing from/to IoT sensors
that implement the Bluetooth Generic Attributes (GATT) profile.

It has been initialy built for use with RaspberryPi 3 and expects that
the `bluez` package has already been installed and that the proper driver
for the bluetooth controller is loaded on boot.

It uses:

- `hciconfig`: to power on/off the bluetooth device
- `hcitool`: to scan for bluetooth devices
- `gatttool`: to read/write from/to characteristics as advertised by the sensor

## Usage

- git clone https://gitlab.com/sadesyllas/bluetooth_sensor_monitor.git
- cd bluetooth_sensor_monitor
- mix deps.get
- iex -S mix

## Usage with [Resin](https://resin.io/)

After cloning simply add your resin remote through `git add remote resin ...` and
do a `git push resin master`, as per
[Resin's documentation](https://docs.resin.io/learn/getting-started/raspberrypi3/nodejs/#deploy-code).

It includes a docker file which is based on `registry.gitlab.com/sadesyllas/raspberrypi3-fedora-elixir`,
a docker image built on `resin/raspberrypi3-fedora` which also includes Erlang and Elixir.

Plus, a `docker-compose.yml` file has been added so that [Resin](https://resin.io/) will
run the project as the `bluetooth_sensor_monitor` service.

This way, it's easy to fork the project and, e.g., include other services as other Dockerfiles in
subfolders.

## Operation

The application implements an FSM that drives communication with `hciconfig`, `hcitool` and `gatttool`,
writing to the `stdin` of these processes and reading their `stdout` and `stderr`.

Messages read this way produce internal, application specific events that change the state of the FSM.

For the state transition graph of the FSM click
[here](https://gitlab.com/sadesyllas/bluetooth_sensor_monitor/raw/master/etc/bluetooth_sensor_monitor_fsm.png).

## API

A simple HTTP API has been implemented for configuring the application during runtime.

| Endpoint              | HTTP Verb | Example Value                                                                  | Description   |
| --------------------- | --------- | ------------------------------------------------------------------------------ | ------------- |
| /read_values          | PUT       |                                                                                | See `1` below |
| /read_values          | DELETE    |                                                                                | See `2` below |
| /read_values_interval | PUT       | 15000                                                                          | See `3` below |
| /values               | GET       |                                                                                | See `4` below |
| /notifications        | POST      | {"host":"localhost","port":"60088","path":"/","proxyHost":null,"timeout":5000} | See `5` below |

Descriptions:

- `1`: Start power on/read/power off sensor cycle
- `2`: Stop power on/read/power off sensor cycle
- `3`: Interval, in milliseonds for the power on/read/power off sensor cycle
- `4`: Request the latest sensor values read
- `5`:
  - `host`: The host receiving the values read, after each cycle
  - `port`: The port where the receiving host should listen
  - `path`: The path where the host will receive the values read
  - `proxyHost`: If set, then the values read will be sent with a header of `Host: <proxyHost>`
  - `timeout`: The timeout of the request when trying to send the values read to the receiving host

## Configuration

By overriding the configuration file `priv/config.ex`, one can provide different mappings
for, e.g., other sensors than the one used during development of the project and describe
how the values that are being read should be parsed and formatted for the interested clients.

The only requirement is to keep the `def config()` function's return value structure the same
so that it can be correctly used by the project.

In general the `devices` key is a mapping from the sensor's id or name (both work) to that
device's configuration.

The key acts as a filter for when filtering nearby devices and as configuration the required
keys are `attributes` which, as shown in the following example, explain *where* and *what*
we must write to turn on/off the various sensors on the bluetooth device and `formatter`,
which is a function to format the data once it has been gathered.

For each attribute, we have the required keys `switch`, describing how to turn a sensor on/off,
`data`, describing how to read the data from the sensor and it `data`, we have the key `parser`,
which is a function responsible for parse the actual bytes off of the sensor reading.

The configuration used while building the project was:

```elixir
# config/config.exs

use Mix.Config

config :logger,
  backends: [:console],
  level: :debug
```

and

```elixir
# priv/config.ex

defmodule Config do
  @moduledoc false

  use Bitwise, only_operators: true

  @devices %{
    "CC2650 SensorTag" => %{
      attributes: [
        humidity: %{
          switch: %{
            uuid: "f000aa22-0451-4000-b000-000000000000",
            on: "01",
            off: "00"
          },
          data: %{
            uuid: "f000aa21-0451-4000-b000-000000000000",
            parser: &Config.parse_humidity/1
          }
        },
        barometric_pressure: %{
          switch: %{
            uuid: "f000aa42-0451-4000-b000-000000000000",
            on: "01",
            off: "00"
          },
          data: %{
            uuid: "f000aa41-0451-4000-b000-000000000000",
            parser: &Config.parse_barometric_pressure/1
          }
        }
      ],
      formatter: &Config.format_data/1
    }
  }

  @default_listen_port 60_080
  @default_read_values_inteval 15_000

  def config() do
    %{
      devices: @devices,
      localhost_listen_port:
        (System.get_env("BSM_LISTEN_PORT") || to_string(@default_listen_port))
        |> Integer.parse()
        |> elem(0),
      read_values?: fn -> System.get_env("BSM_READ_VALUES") === "true" end,
      read_values_interval: fn ->
        (System.get_env("BSM_READ_VALUES_INTERVAL") || to_string(@default_read_values_inteval))
        |> Integer.parse()
        |> elem(0)
      end
    }
  end

  def parse_humidity(<<temp2, temp1, hum2, hum1>>) do
    temp = Integer.undigits([temp1, temp2], 256) / 65536 * 165 - 40
    hum = (Integer.undigits([hum1, hum2], 256) &&& ~~~0x0003) / 65536 * 100

    %{
      temperature: %{
        value: temp,
        unit: "C"
      },
      relative_humidity: %{
        value: hum,
        unit: "%RH"
      }
    }
  end

  def parse_barometric_pressure(<<temp3, temp2, temp1, press3, press2, press1>>) do
    temp = Integer.undigits([temp1, temp2, temp3], 256) / 100
    press = Integer.undigits([press1, press2, press3], 256) / 100

    %{
      temperature: %{
        value: temp,
        unit: "C"
      },
      barometric_pressure: %{
        value: press,
        unit: "hPa"
      }
    }
  end

  def format_data(data), do: Map.new(data)
end
```
