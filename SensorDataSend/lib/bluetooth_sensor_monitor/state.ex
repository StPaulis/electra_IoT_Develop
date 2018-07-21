defmodule BluetoothSensorMonitor.State do
  @moduledoc false
  @module __MODULE__

  require Logger

  use GenServer

  alias BluetoothSensorMonitor.Publisher

  def start_link(_) do
    GenServer.start_link(@module, nil, name: @module)
  end

  @impl true
  def init(_) do
    {:ok, nil}
  end

  def get() do
    GenServer.call(@module, :get)
  end

  def set(data) do
    GenServer.call(@module, {:set, data})
  end

  @impl true
  def handle_call({:set, data}, _from, _state) do
    Logger.debug("[VALUES SET IN STATE] #{inspect(data)}")

    Publisher.publish(data)

    {:reply, data, data}
  end

  @impl true
  def handle_call(:get, _from, state) do
    {:reply, state, state}
  end
end
