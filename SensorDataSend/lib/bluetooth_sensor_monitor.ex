defmodule BluetoothSensorMonitor do
  @moduledoc false

  defmacro config(method) do
    quote do
      :bluetooth_sensor_monitor
      |> Application.app_dir("priv/config.ex")
      |> Code.unquote(method)()
    end
  end
end
