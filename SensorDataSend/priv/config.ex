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
