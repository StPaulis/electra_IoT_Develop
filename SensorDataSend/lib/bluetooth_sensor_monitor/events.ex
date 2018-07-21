defmodule BluetoothSensorMonitor.Events do
  @moduledoc false
  @module __MODULE__

  def child_spec(_) do
    Registry.child_spec(keys: :duplicate, name: @module, partitions: System.schedulers_online())
  end

  def subscribe() do
    Registry.register(@module, :event, nil)
  end

  def publish(message) do
    Registry.dispatch(@module, :event, fn pids ->
      Enum.each(pids, fn {pid, _} -> send(pid, message) end)
    end)
  end
end
