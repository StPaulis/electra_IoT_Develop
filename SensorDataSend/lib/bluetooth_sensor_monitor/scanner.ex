defmodule BluetoothSensorMonitor.Scanner do
  @moduledoc false
  @module __MODULE__

  require Logger

  use GenServer

  alias BluetoothSensorMonitor.{PortHelper, Events, Utils}

  import Config

  def start_link(_) do
    GenServer.start_link(@module, nil, name: @module)
  end

  @impl true
  def init(_) do
    Events.subscribe()

    {:ok, %{port_helper: nil}}
  end

  def start() do
    GenServer.cast(@module, :start)
  end

  def stop() do
    GenServer.cast(@module, :stop)
  end

  @impl true
  def handle_cast(:start, state) do
    Logger.debug("[SCANNING]")

    {:ok, pid} =
      PortHelper.start_link(
        name: "sudo",
        args: ["hcitool", "lescan", "--duplicates"],
        events_config: {Events, :scanner}
      )

    Events.publish(:scanner_started)

    state = %{state | port_helper: pid}

    {:noreply, state}
  end

  @impl true
  def handle_cast(:stop, %{port_helper: nil} = state) do
    Logger.debug("[SCANNER ALREADY STOPPED]")

    Events.publish(:scanner_stopped)

    {:noreply, state}
  end

  @impl true
  def handle_cast(:stop, %{port_helper: port_helper} = state) do
    Logger.debug("[SCANNER STOPPING]")

    PortHelper.close(port_helper)

    Events.publish(:scanner_stopped)

    state = %{state | port_helper: nil}

    {:noreply, state}
  end

  @impl true
  def handle_info({:scanner, data}, state) do
    handle_scan_data(data)

    {:noreply, state}
  end

  @impl true
  def handle_info(_, state) do
    {:noreply, state}
  end

  defp handle_scan_data([_, "(unknown)"]), do: nil

  defp handle_scan_data([
         <<_, _, ":", _, _, ":", _, _, ":", _, _, ":", _, _, ":", _, _>> = id,
         <<name::binary>>
       ]) do
    if Utils.get_device_key(config(), id, name) do
      Events.publish({:device_found, id, name})
    end
  end

  defp handle_scan_data(data) when is_binary(data) do
    data |> String.trim() |> String.split(" ", trim: true, parts: 2) |> handle_scan_data()
  end

  defp handle_scan_data(_), do: nil
end
