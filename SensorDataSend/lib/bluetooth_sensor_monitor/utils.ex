defmodule BluetoothSensorMonitor.Utils do
  @moduledoc false

  def get_device_key(config, id, name) do
    cond do
      Map.has_key?(config.devices, id) -> id
      Map.has_key?(config.devices, name) -> name
      true -> nil
    end
  end
end
