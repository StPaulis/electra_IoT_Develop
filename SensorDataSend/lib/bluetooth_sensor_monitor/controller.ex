defmodule BluetoothSensorMonitor.Controller do
  @moduledoc false
  @module __MODULE__

  require Logger

  use GenServer

  alias BluetoothSensorMonitor.{PortHelper, Events}

  def start_link(_) do
    GenServer.start_link(@module, nil, name: @module)
  end

  @impl true
  def init(_) do
    Events.subscribe()

    {:ok, %{port_helper: nil}}
  end

  def start(id) do
    GenServer.cast(@module, {:start, id})
  end

  def write(what) do
    GenServer.cast(@module, {:write, what})
  end

  def stop() do
    GenServer.cast(@module, :stop)
  end

  @impl true
  def handle_cast({:start, id}, state) do
    Logger.debug("[STARTING CONTROLLER] #{id}")

    {:ok, pid} =
      PortHelper.start_link(
        name: "sudo",
        args: ["gatttool", "-b", id, "--interactive"],
        events_config: {Events, :controller}
      )

    Events.publish(:controller_started)

    state = %{state | port_helper: pid}

    {:noreply, state}
  end

  @impl true
  def handle_cast({:write, what}, %{port_helper: port_helper} = state) do
    Logger.debug("[WRITTING TO CONTROLLER] #{what}")

    PortHelper.write(port_helper, what)

    {:noreply, state}
  end

  @impl true
  def handle_cast(:stop, %{port_helper: nil} = state) do
    Logger.debug("[CONTROLLER ALREADY STOPPED]")

    Events.publish(:controller_stopped)

    {:noreply, state}
  end

  @impl true
  def handle_cast(:stop, %{port_helper: port_helper} = state) do
    Logger.debug("[CONTROLLER STOPPING]")

    PortHelper.close(port_helper)

    Events.publish(:controller_stopped)

    state = %{state | port_helper: nil}

    {:noreply, state}
  end

  @impl true
  def handle_info({:controller, data}, state) do
    handle_controller_data(data)

    {:noreply, state}
  end

  @impl true
  def handle_info(_, state) do
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, _state) do
    Events.publish(:device_disconnected)

    :ok
  end

  defp handle_controller_data(data) when is_binary(data) do
    cond do
      Regex.match?(~r/connection successful/i, data) -> Events.publish(:device_connected)
      Regex.match?(~r/handle: .+?, uuid: .+/, data) -> extract_and_publish_attribute(data)
      Regex.match?(~r/characteristic value\/descriptor:/i, data) -> extract_and_publish_value(data)
      Regex.match?(~r/command failed: disconnected/i, data) -> Events.publish(:device_disconnected)
      Regex.match?(~r/error:/i, data) -> Events.publish(:device_disconnected)
      Regex.match?(~r/invalid file descriptor/i, data) -> Events.publish(:device_disconnected)
      true -> nil
    end
  end

  defp handle_controller_data(_), do: nil

  defp extract_and_publish_attribute(data) do
    %{"handle" => handle, "uuid" => uuid} =
      Regex.named_captures(
        ~r/handle: (?<handle>0x[0-9a-zA-Z]+), uuid: (?<uuid>[0-9a-zA-Z-]+)/,
        String.trim(data)
      )

    Events.publish({:attribute_found, handle, uuid})
  end

  defp extract_and_publish_value(data) do
    %{"value" => value} =
      Regex.named_captures(
        ~r/Characteristic value\/descriptor: (?<value>[0-9a-zA-Z ]+)/,
        String.trim(data)
      )

    value =
      value
      |> String.split(" ", trim: true)
      |> Enum.map(&String.upcase/1)
      |> Enum.map(&Base.decode16!/1)
      |> Enum.reduce(<<>>, &(&2 <> &1))

    Events.publish({:value, value})
  end
end
